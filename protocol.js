const msgpack = require('@msgpack/msgpack');

// Optional logger - try to load, fallback to console
let logger;
try {
  logger = require('../utils/logger');
} catch (_) {
  logger = {
    security: (...args) => console.warn('[PROTOCOL:SECURITY]', ...args),
    warn: (...args) => console.warn('[PROTOCOL]', ...args),
  };
}

/**
 * Opcodes matching MMORPG_Client.js
 */
const Opcode = {
  // Client -> Server
  PING: 0,
  LOAD: 1,
  SAVE: 2,
  SUBSCRIBE: 3,
  BROADCAST: 4,
  PUBLISH: 5,
  SENDTO: 6,
  REPORT: 9,
  
  // Admin
  ONLINE: 100,
  BANNED: 101,
  BANNING: 102,
  INSPECT: 103,
  OVERWRITE: 104,

  // Server -> Client
  PONG: 0,
  RESPONSE: 1,
  RECV: 2
};

/**
 * Binary message reader matching client's Reader class
 * IMPORTANT: Client uses 1-byte length prefixes for strings and values!
 */
class Reader {
  constructor(buffer) {
    this.buffer = Buffer.from(buffer);
    this.offset = 0;
  }

  getByte() {
    if (this.offset >= this.buffer.length) {
      throw new Error('Buffer underflow');
    }
    return this.buffer[this.offset++];
  }

  getBytes(len) {
    if (this.offset + len > this.buffer.length) {
      throw new Error('Buffer underflow');
    }
    const bytes = this.buffer.slice(this.offset, this.offset + len);
    this.offset += len;
    return bytes;
  }

  getString() {
    const len = this.getByte();
    if (len === 0) return '';
    const bytes = this.getBytes(len);
    return bytes.toString('utf8');
  }

  getValue() {
    const len = this.getByte();
    if (len === 0) return undefined;
    const bytes = this.getBytes(len);
    return msgpack.decode(bytes);
  }

  // Get remaining bytes (for args encoded as single msgpack array)
  bytes() {
    return this.buffer.slice(this.offset);
  }

  size() {
    return this.buffer.length - this.offset;
  }

  empty() {
    return this.size() < 1;
  }
}

/**
 * Binary message writer matching client's Writer class
 * IMPORTANT: Client uses 1-byte length prefixes for strings and values!
 * 
 * FIX: Truncate oversized strings/values instead of throwing to prevent DoS
 */
class Writer {
  constructor() {
    this.buffer = Buffer.alloc(1024);
    this.pos = 0;
  }

  ensureCapacity(needed) {
    if (this.pos + needed > this.buffer.length) {
      const newBuf = Buffer.alloc(this.buffer.length * 2);
      this.buffer.copy(newBuf);
      this.buffer = newBuf;
    }
  }

  putByte(value) {
    this.ensureCapacity(1);
    this.buffer[this.pos++] = value;
    return this;
  }

  putBytes(value) {
    const len = value.length;
    this.ensureCapacity(len);
    if (Buffer.isBuffer(value)) {
      value.copy(this.buffer, this.pos);
    } else {
      this.buffer.set(value, this.pos);
    }
    this.pos += len;
    return this;
  }

  /**
   * FIX: Truncate strings longer than 255 bytes instead of throwing.
   * This prevents a malicious client from crashing message processing.
   */
  putString(str) {
    if (!str || str.length === 0) {
      this.putByte(0);
      return this;
    }
    let encoded = Buffer.from(str, 'utf8');
    if (encoded.length > 255) {
      // SECURITY FIX: Truncate instead of throw to prevent DoS
      logger.security('String truncated in protocol', { originalLength: encoded.length });
      // Truncate to 255 bytes (may split a multi-byte char, so we trim further)
      encoded = encoded.slice(0, 255);
      // Find valid UTF-8 boundary by decoding and re-encoding
      const truncatedStr = encoded.toString('utf8');
      encoded = Buffer.from(truncatedStr, 'utf8');
      // Final safety: ensure it's 255 or less
      if (encoded.length > 255) {
        encoded = encoded.slice(0, 255);
      }
    }
    this.putByte(encoded.length);
    this.putBytes(encoded);
    return this;
  }

  /**
   * FIX: Truncate values longer than 255 bytes instead of throwing.
   */
  putValue(value) {
    if (value === null || value === undefined) {
      this.putByte(0);
      return this;
    }
    let encoded = Buffer.from(msgpack.encode(value));
    if (encoded.length > 255) {
      // SECURITY FIX: Log and truncate instead of throw
      logger.security('Value truncated in protocol', { originalLength: encoded.length, type: typeof value });
      // For values, truncating msgpack is dangerous (corrupts data)
      // Instead, replace with a placeholder or empty value
      encoded = Buffer.from(msgpack.encode('[truncated]'));
      if (encoded.length > 255) {
        encoded = Buffer.from(msgpack.encode(null));
      }
    }
    this.putByte(encoded.length);
    this.putBytes(encoded);
    return this;
  }

  bytes() {
    return this.buffer.slice(0, this.pos);
  }

  toBuffer() {
    return this.bytes();
  }
}

/**
 * Parse incoming message from client
 */
function parseMessage(data) {
  const reader = new Reader(data);
  const opcode = reader.getByte();

  switch (opcode) {
    case Opcode.PING:
      return { opcode, timestamp: reader.getValue() };

    case Opcode.LOAD:
      return {
        opcode,
        global: reader.getByte() === 1,
        keyName: reader.getString(),
        queryId: reader.getValue()
      };

    case Opcode.SAVE: {
      const global = reader.getByte() === 1;
      const keyName = reader.getString();
      const fields = {};
      while (!reader.empty()) {
        const field = reader.getString();
        const value = reader.getValue();
        if (field) {
          fields[field] = value;
        }
      }
      return { opcode, global, keyName, fields };
    }

    case Opcode.SUBSCRIBE: {
      const group = reader.getString();
      const channel = reader.getString();
      // Args are encoded as a single msgpack array in remaining bytes
      let args = [];
      if (reader.size() > 0) {
        try {
          args = msgpack.decode(reader.bytes()) || [];
        } catch (e) {
          args = [];
        }
      }
      return { opcode, group, channel, args };
    }

    case Opcode.BROADCAST: {
      const loopback = reader.getByte() === 1;
      const code = reader.getString();
      let args = [];
      if (reader.size() > 0) {
        try {
          args = msgpack.decode(reader.bytes()) || [];
        } catch (e) {
          args = [];
        }
      }
      return { opcode, loopback, code, args };
    }

    case Opcode.PUBLISH: {
      const loopback = reader.getByte() === 1;
      const group = reader.getString();
      const code = reader.getString();
      let args = [];
      if (reader.size() > 0) {
        try {
          args = msgpack.decode(reader.bytes()) || [];
        } catch (e) {
          args = [];
        }
      }
      return { opcode, loopback, group, code, args };
    }

    case Opcode.SENDTO: {
      const targetUser = reader.getString();
      const code = reader.getString();
      let args = [];
      if (reader.size() > 0) {
        try {
          args = msgpack.decode(reader.bytes()) || [];
        } catch (e) {
          args = [];
        }
      }
      return { opcode, targetUser, code, args };
    }

    case Opcode.REPORT:
      return {
        opcode,
        reportedUser: reader.getString(),
        reason: reader.getString()
      };

    // Admin commands
    case Opcode.ONLINE:
      return { opcode, queryId: reader.getValue() };

    case Opcode.BANNED:
      return { opcode, queryId: reader.getValue() };

    case Opcode.BANNING:
      return {
        opcode,
        user: reader.getString(),
        state: reader.getByte() === 1,
        queryId: reader.getValue()
      };

    case Opcode.INSPECT:
      return {
        opcode,
        user: reader.getString(),
        keyName: reader.getString(),
        queryId: reader.getValue()
      };

    case Opcode.OVERWRITE: {
      const user = reader.getString();
      const keyName = reader.getString();
      const queryId = reader.getValue();
      const fields = {};
      while (!reader.empty()) {
        const field = reader.getString();
        const value = reader.getValue();
        if (field) {
          fields[field] = value;
        }
      }
      return { opcode, user, keyName, queryId, fields };
    }

    default:
      return { opcode, raw: data };
  }
}

/**
 * Create pong response
 */
function createPong(timestamp) {
  return new Writer()
    .putByte(Opcode.PONG)
    .putValue(timestamp)
    .toBuffer();
}

/**
 * Create response message (for load queries)
 */
function createResponse(queryId, data) {
  const writer = new Writer()
    .putByte(Opcode.RESPONSE)
    .putValue(queryId);

  if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      writer.putString(key);
      writer.putValue(value);
    }
  }

  return writer.toBuffer();
}

/**
 * Create recv message (relayed message from another client)
 */
function createRecv(group, fromUser, code, args) {
  const writer = new Writer()
    .putByte(Opcode.RECV)
    .putString(group)
    .putString(fromUser)
    .putString(code);

  // Args are encoded as a single msgpack array
  if (args && args.length > 0) {
    writer.putBytes(Buffer.from(msgpack.encode(args)));
  }

  return writer.toBuffer();
}

module.exports = {
  Opcode,
  Reader,
  Writer,
  parseMessage,
  createPong,
  createResponse,
  createRecv
};
