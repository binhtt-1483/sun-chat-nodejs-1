'use strict';

/**
 * Module dependencies.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');
const moment = require('moment-timezone');
const config = require('../../config/config');
const Schema = mongoose.Schema;
const oAuthTypes = ['github', 'twitter', 'google', 'linkedin'];
const Room = require('./room');
/**
 * User Schema
 */

const UserSchema = new Schema(
  {
    name: {
      type: String,
      default: '',
      required: true,
    },
    email: {
      type: String,
      default: '',
      lowercase: true,
      unique: true,
      required: true,
    },
    username: {
      type: String,
      default: '',
      unique: true,
      required: true,
    },
    full_address: {
      type: String,
      default: '',
    },
    phone_number: {
      type: String,
      default: '',
    },
    provider: {
      type: String,
      default: '',
    },
    hashed_password: {
      type: String,
      default: '',
      required: true,
    },
    salt: {
      type: String,
      default: '',
    },
    active: {
      type: Boolean,
      default: false,
    },
    active_token: {
      type: String,
    },
    active_token_expire: {
      type: Date,
      default: moment().add(process.env.ACTIVE_TOKEN_EXPIRE_TIME, 'days'),
    },
    twitter: {
      type: String,
      default: '',
    },
    github: {
      type: String,
      default: '',
    },
    google: {
      type: String,
      default: '',
    },
    linkedin: {},
    requested_in_comming: [
      {
        type: Schema.ObjectId,
        ref: 'User',
      },
    ],
    avatar: {
      type: String,
      default: '',
    },
    reset_token: {
      type: String,
      default: '',
    },
    reset_token_expire: {
      type: Date,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Virtuals
 */
const validatePresenceOf = value => value && value.length;

/**
 * Virtuals
 */

UserSchema.virtual('password')
  .set(function(password) {
    this._password = password;
    this.salt = this.makeSalt();
    this.hashed_password = this.encryptPassword(password);
  })
  .get(function() {
    return this._password;
  });

/**
 * Validations
 */

/**
 * Pre-save hook
 */

UserSchema.pre('save', function(next) {
  if (!this.isNew) return next();

  if (!validatePresenceOf(this.password) && !this.skipValidation()) {
    next(new Error('Invalid password'));
  } else {
    next();
  }
});

/**
 * Methods
 */

UserSchema.methods = {
  /**
   * Authenticate - check if the passwords are the same
   *
   * @param {String} plainText
   * @return {Boolean}
   * @api public
   */

  authenticate: function(plainText) {
    return this.encryptPassword(plainText) === this.hashed_password;
  },

  /**
   * Make salt
   *
   * @return {String}
   * @api public
   */

  makeSalt: function() {
    return Math.round(new Date().valueOf() * Math.random()) + '';
  },

  /**
   * Encrypt password
   *
   * @param {String} password
   * @return {String}
   * @api public
   */

  encryptPassword: function(password) {
    if (!password) return '';
    try {
      return crypto
        .createHmac('sha1', this.salt)
        .update(password)
        .digest('hex');
    } catch (err) {
      return '';
    }
  },

  /**
   * Validation is not required if using OAuth
   */

  skipValidation: function() {
    return ~oAuthTypes.indexOf(this.provider);
  },

  updatePassword: function(newPassword) {
    try {
      this.hashed_password = this.encryptPassword(newPassword);
      this.save();
    } catch (err) {
      throw new Error(err);
    }
  },
  /**
   * Reset password
   */
  resetPassword: function(password) {
    try {
      this.password = password;
      this.reset_token = '';
      this.reset_token_expire = '';

      return this.save();
    } catch (err) {
      throw new Error(err.toString());
    }
  },
};

/**
 * Statics
 */

UserSchema.statics = {
  /**
   * Load
   *
   * @param {Object} options
   * @param {Function} cb
   * @api private
   */

  load: function(options, cb) {
    options.select = options.select || 'name username hashed_password salt reset_token_expire email active';

    return this.findOne(options.criteria)
      .select(options.select)
      .exec(cb);
  },

  loadForEdit: function(userId, flagProfile = false) {
    const query = [
      {
        $match: { _id: mongoose.Types.ObjectId(userId) },
      },
    ];

    if (flagProfile) {
      query.push({
        $project: {
          name: 1,
          email: 1,
          username: 1,
          twitter: 1,
          github: 1,
          google: 1,
          full_address: 1,
          phone_number: 1,
          avatar: 1,
          requested_in_comming: 1,
        },
      });
    } else {
      query.push({
        $project: {
          name: 1,
          username: 1,
          hashed_password: 1,
          salt: 1,
          reset_token_expire: 1,
          email: 1,
          active: 1,
          requested_in_comming: 1,
        },
      });
    }

    return this.aggregate(query);
  },

  getMyContactRequest: function(userId, options) {
    let limit = options.limit;
    const page = options.page || 0;

    return this.find(
      {
        _id: userId,
      },
      { name: 1, requested_in_comming: { $slice: [limit * page, limit] } }
    )
      .populate({
        path: 'requested_in_comming',
        select: { avatar: 1, name: 1, _id: 1, email: 1 },
      })
      .exec();
  },

  getReceivedRequestCount: async function(userId) {
    let requestCount = await this.aggregate([
      { $match: { _id: mongoose.Types.ObjectId(userId) } },
      {
        $project: {
          number_of_contact: {
            $cond: { if: { $isArray: '$requested_in_comming' }, then: { $size: '$requested_in_comming' }, else: 0 },
          },
        },
      },
    ]);

    return requestCount[0]['number_of_contact'];
  },

  updateInfo: function(options) {
    return this.findOneAndUpdate(
      { _id: mongoose.Types.ObjectId(options.criteria._id) },
      { $set: options.data },
      {
        fields: { 'avatar': 1, 'email': 1, 'name': 1 },
        new: true
      }
    );
  },

  acceptRequest: async function(userId, requestUserIds) {
    for (let i = 0; i < requestUserIds.length; i++) {
      let rooms = new Room({ type: config.ROOM_TYPE.DIRECT_CHAT });
      rooms.members.push(
        { user: userId, role: config.MEMBER_ROLE.MEMBER },
        { user: requestUserIds[i], role: config.MEMBER_ROLE.MEMBER }
      );
      await rooms.save();
    }

    return this.update({ _id: userId }, { $pull: { requested_in_comming: { $in: requestUserIds } } });
  },

  getListContacts: function({ limit, page = 0, userId, searchText = '' }, getListFlag = false) {
    const text = `.*${searchText}.*`;
    const query = [
      {
        $match: {
          type: config.ROOM_TYPE.DIRECT_CHAT,
          deletedAt: null,
          'members.user': mongoose.Types.ObjectId(userId),
        },
      },
      {
        $unwind: {
          path: '$members',
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: 'members.user',
          foreignField: '_id',
          as: 'info_user',
        },
      },
      {
        $addFields: {
          member: { $arrayElemAt: ['$info_user', 0] },
        },
      },
      {
        $project: {
          _id: '$member._id',
          room_id: '$_id',
          name: '$member.name',
          username: '$member.username',
          email: '$member.email',
          full_address: '$member.full_address',
          phone_number: '$member.phone_number',
          twitter: '$member.twitter',
          google: '$member.google',
          github: '$member.github',
          avatar: '$member.avatar',
        },
      },
      {
        $match: {
          _id: { $ne: mongoose.Types.ObjectId(userId) },
          $or: [
            { name: { $regex: text, $options: '$i' } },
            { username: { $regex: text, $options: '$i' } },
            { email: { $regex: `${text}@sun-asterisk\.com`, $options: '$i' } },
          ],
        },
      },
    ];

    if (getListFlag) {
      query.push(
        {
          $skip: limit * page,
        },
        {
          $limit: limit,
        }
      );
    } else {
      query.push({
        $count: 'number_of_contacts',
      });
    }

    return Room.aggregate(query);
  },

  deleteContact: function(userId, contactId) {
    return Room.findOneAndUpdate(
      {
        type: config.ROOM_TYPE.DIRECT_CHAT,
        deletedAt: null,
        'members.user': userId,
        members: { $elemMatch: { user: contactId } },
      },
      { $set: { deletedAt: Date.now() } }
    );
  },

  getSendRequestMakeFriend: function(userId, options = {}) {
    let select = typeof options ? { _id: 1, name: 1, username: 1, email: 1, avatar: 1 } : { _id: 1 };
    let limit = options.limit || '';
    let page = options.page || 0;

    return this.find({ requested_in_comming: { $in: [userId] }, deletedAt: null })
      .limit(limit)
      .skip(limit * page)
      .select(select)
      .exec();
  },

  getListRequestedMakeFriend: function(userId) {
    return this.findOne({ _id: userId }, { requested_in_comming: 1, _id: 0 }).exec();
  },

  getSearchContactByName: function(options) {
    options.select = options.select || '_id name username email avatar';
    let regexText = `.*${options.searchText}.*`;
    let regexEmail = `.*${options.searchText}.*@sun-asterisk\.com`;
    let limit = options.limit || '';
    let page = options.page || 0;

    return this.find({ $and: [{ _id: { $nin: options.listUserIdsIgnore } }, { active: true }, { deletedAt: null }] })
      .or([
        { name: { $regex: regexText, $options: '$xi' } },
        { username: { $regex: regexText, $options: '$xi' } },
        { email: { $regex: regexEmail, $options: '$xi' } },
      ])
      .limit(limit)
      .skip(limit * page)
      .select(options.select)
      .exec();
  },

  getListContactIds: function({ userId }) {
    return Room.find(
      {
        type: config.ROOM_TYPE.DIRECT_CHAT,
        'members.user': userId,
        deletedAt: null,
      },
      { members: { $elemMatch: { user: { $ne: userId } } }, _id: 0 }
    ).exec();
  },

  /**
   * Update Send Request Friend
   */
  updateRequestFriend: function(userIdReceive, userIdSend) {
    try {
      return this.update({ _id: userIdReceive }, { $addToSet: { requested_in_comming: userIdSend } });
    } catch (err) {
      throw new Error(err);
    }
  },

  deleteSentRequestContact: function(userId, requestSentContactId) {
    try {
      return this.updateOne({ _id: requestSentContactId }, { $pull: { requested_in_comming: { $in: userId } } });
    } catch (err) {
      throw new Error(err);
    }
  },

  getRequestSentContactCount: function(userId) {
    return this.find({
      requested_in_comming: { $in: [userId] },
      deletedAt: null,
    })
      .select()
      .count()
      .exec();
  },

  getInfoUser: function(userId) {
    return this.findOne({
      _id: userId,
    })
      .select('_id name email username avatar')
      .exec();
  },
};

module.exports = mongoose.model('User', UserSchema);
