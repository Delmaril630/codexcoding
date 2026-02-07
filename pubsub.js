const logger = require('../utils/logger');

/**
 * Pub/Sub system for managing channel subscriptions
 * 
 * Channel structure:
 * - "map": All players subscribed to map channel
 * - "party": Map of partyId -> Set of connections
 * - "guild": Map of guildId -> Set of connections
 * - Custom channels follow same pattern
 */
class PubSub {
  constructor() {
    // Map of group -> Map of channel -> Set of connections
    this.subscriptions = new Map();
    
    // Reverse lookup: connection -> Set of {group, channel}
    this.connectionChannels = new Map();
  }

  /**
   * Subscribe a connection to a channel
   */
  subscribe(connection, group, channel) {
    // Ensure group exists
    if (!this.subscriptions.has(group)) {
      this.subscriptions.set(group, new Map());
    }

    const groupChannels = this.subscriptions.get(group);

    // Ensure channel exists
    if (!groupChannels.has(channel)) {
      groupChannels.set(channel, new Set());
    }

    // Add connection to channel
    groupChannels.get(channel).add(connection);

    // Track in reverse lookup
    if (!this.connectionChannels.has(connection)) {
      this.connectionChannels.set(connection, new Set());
    }
    this.connectionChannels.get(connection).add(`${group}:${channel}`);

    logger.debug('PUBSUB', `Subscribed to ${group}/${channel}`, { 
      userId: connection.userId,
      subscribers: groupChannels.get(channel).size
    });
  }

  /**
   * Unsubscribe a connection from a channel
   */
  unsubscribe(connection, group, channel) {
    const groupChannels = this.subscriptions.get(group);
    if (!groupChannels) return;

    const channelSubs = groupChannels.get(channel);
    if (!channelSubs) return;

    channelSubs.delete(connection);

    // Cleanup empty channel
    if (channelSubs.size === 0) {
      groupChannels.delete(channel);
    }

    // Cleanup empty group
    if (groupChannels.size === 0) {
      this.subscriptions.delete(group);
    }

    // Update reverse lookup
    const connChannels = this.connectionChannels.get(connection);
    if (connChannels) {
      connChannels.delete(`${group}:${channel}`);
    }

    logger.debug('PUBSUB', `Unsubscribed from ${group}/${channel}`, { 
      userId: connection.userId 
    });
  }

  /**
   * Unsubscribe a connection from all channels in a specific group
   */
  unsubscribeGroup(connection, group) {
    const connChannels = this.connectionChannels.get(connection);
    if (!connChannels) return;

    const groupChannels = this.subscriptions.get(group);
    if (!groupChannels) return;

    // Find and remove all channels in this group
    const toRemove = [];
    for (const channelKey of connChannels) {
      const [g, c] = channelKey.split(':');
      if (g === group) {
        toRemove.push({ group: g, channel: c, key: channelKey });
      }
    }

    for (const { group: g, channel: c, key } of toRemove) {
      const channelSubs = groupChannels.get(c);
      if (channelSubs) {
        channelSubs.delete(connection);
        if (channelSubs.size === 0) {
          groupChannels.delete(c);
        }
      }
      connChannels.delete(key);
    }

    // Cleanup empty group
    if (groupChannels.size === 0) {
      this.subscriptions.delete(group);
    }

    if (toRemove.length > 0) {
      logger.debug('PUBSUB', `Unsubscribed from group ${group}`, { 
        userId: connection.userId,
        channels: toRemove.length
      });
    }
  }

  /**
   * Unsubscribe a connection from all channels (on disconnect)
   */
  unsubscribeAll(connection) {
    const channels = this.connectionChannels.get(connection);
    if (!channels) return;

    for (const channelKey of channels) {
      const [group, channel] = channelKey.split(':');
      
      const groupChannels = this.subscriptions.get(group);
      if (groupChannels) {
        const channelSubs = groupChannels.get(channel);
        if (channelSubs) {
          channelSubs.delete(connection);
          
          if (channelSubs.size === 0) {
            groupChannels.delete(channel);
          }
        }
        
        if (groupChannels.size === 0) {
          this.subscriptions.delete(group);
        }
      }
    }

    this.connectionChannels.delete(connection);
    
    logger.debug('PUBSUB', `Unsubscribed from all channels`, { 
      userId: connection.userId,
      channelCount: channels.size
    });
  }

  /**
   * Get all subscribers to a group/channel
   */
  getSubscribers(group, channel) {
    const groupChannels = this.subscriptions.get(group);
    if (!groupChannels) return new Set();

    return groupChannels.get(channel) || new Set();
  }

  /**
   * Publish a message to all subscribers of a channel
   * @param {string} group - Group name
   * @param {string} channel - Channel name
   * @param {Buffer} message - Message to send
   * @param {WebSocket} exclude - Optional connection to exclude (sender)
   */
  publish(group, channel, message, exclude = null) {
    const subscribers = this.getSubscribers(group, channel);
    let sent = 0;

    for (const conn of subscribers) {
      if (conn !== exclude && conn.readyState === 1) { // 1 = OPEN
        try {
          conn.send(message);
          sent++;
        } catch (err) {
          logger.error('PUBSUB', `Failed to send to subscriber`, { 
            userId: conn.userId, 
            error: err.message 
          });
        }
      }
    }

    logger.debug('PUBSUB', `Published to ${group}/${channel}`, { 
      subscribers: subscribers.size, 
      sent 
    });

    return sent;
  }

  /**
   * Broadcast to all subscribers in a group (all channels)
   */
  broadcastToGroup(group, message, exclude = null) {
    const groupChannels = this.subscriptions.get(group);
    if (!groupChannels) return 0;

    const allSubscribers = new Set();
    for (const channelSubs of groupChannels.values()) {
      for (const conn of channelSubs) {
        allSubscribers.add(conn);
      }
    }

    let sent = 0;
    for (const conn of allSubscribers) {
      if (conn !== exclude && conn.readyState === 1) {
        try {
          conn.send(message);
          sent++;
        } catch (err) {
          logger.error('PUBSUB', `Failed to broadcast`, { 
            userId: conn.userId, 
            error: err.message 
          });
        }
      }
    }

    return sent;
  }

  /**
   * Get stats for monitoring
   */
  getStats() {
    const stats = {
      groups: this.subscriptions.size,
      channels: 0,
      connections: this.connectionChannels.size
    };

    for (const groupChannels of this.subscriptions.values()) {
      stats.channels += groupChannels.size;
    }

    return stats;
  }

  /**
   * Get detailed info for admin panel
   */
  getDetailedStats() {
    const details = [];

    for (const [group, groupChannels] of this.subscriptions) {
      for (const [channel, subscribers] of groupChannels) {
        details.push({
          group,
          channel,
          subscribers: subscribers.size,
          users: Array.from(subscribers).map(c => c.userId)
        });
      }
    }

    return details;
  }
}

// Singleton instance
const pubsub = new PubSub();

module.exports = pubsub;
