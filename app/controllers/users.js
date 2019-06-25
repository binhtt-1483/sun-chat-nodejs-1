'use strict';

/**
 * Module dependencies.
 */

const mongoose = require('mongoose');
const { wrap: async } = require('co');
const User = mongoose.model('User');
const { validationResult } = require('express-validator/check');
const { user: userMiddleware } = require('../../config/middlewares/authorization.js');
const crypto = require('crypto');
const mailer = require('../mailer/email.action');
mongoose.set('useFindAndModify', false);
const config = require('../../config/config');
const moment = require('moment-timezone');
const logger = require('./../logger/winston');
const channel = logger.init('error');
const contact = require('./../services/contactService.js');
const Room = mongoose.model('Room');
const files = require('../services/files.js');
const slug = require('slug');

/**
 * Load
 */

exports.load = async(function*(req, res, next, _id) {
  const criteria = { _id };
  try {
    req.profile = yield User.load({ criteria });
    if (!req.profile) return next(new Error('User not found'));
  } catch (err) {
    return next(err);
  }
  next();
});

/**
 * Create user
 */

exports.create = async(function*(req, res) {
  const user = new User(req.body);
  user.provider = 'local';

  try {
    yield user.save();
    req.logIn(user, err => {
      if (err) req.flash('info', 'Sorry! We are not able to log you in!');
      res.redirect('/');
    });
  } catch (err) {
    const errors = Object.keys(err.errors).map(field => err.errors[field].message);

    res.render('users/signup', {
      title: 'Sign up',
      errors,
      user,
    });
  }
});

/**
 *  Show profile
 */

exports.show = async(function*(req, res) {
  const { _id } = req.decoded;
  const flagProfile = true;
  const user = yield User.loadForEdit(_id, flagProfile);
  const roomMyChatId = yield Room.getRoomMyChatId(_id);

  res.status(200).json({
    user: user.length != 0 ? user[0] : null,
    my_chat_id: roomMyChatId.length != 0 ? roomMyChatId[0]._id : null,
  });
});

exports.update = async(function*(req, res) {
  const { _id } = req.decoded;
  const io = req.app.get('socketIO');
  const criteria = { _id: _id };
  const error = validationResult(req);
  const pathUserAvatar = config.DIR_UPLOAD_FILE.USER_AVATAR;

  if (error.array().length) {
    const errors = customMessageValidate(error);

    return res.status(422).json(errors);
  }

  try {
    const data_changed = {
      criteria,
      data: {
        name: req.body.name,
        email: req.body.email,
        username: req.body.username,
        twitter: req.body.twitter,
        github: req.body.github,
        google: req.body.google,
        full_address: req.body.address,
        phone_number: req.body.phone,
        avatar: req.body.avatar,
      },
    };

    if (data_changed.data.avatar) {
      try {
        yield files.saveImage(data_changed.data.avatar, slug(data_changed.data.name, '-'), pathUserAvatar).then(url => {
          data_changed.data.avatar = url;
        });
      } catch (err) {
        channel.error(err);

        return res.status(500).json({ error: __('update_to_fail_user') });
      }
    } else {
      delete data_changed.data.avatar;
    }

    const user = yield User.updateInfo(data_changed);

    if (!user) {
      throw new Error(__('update_to_fail_user'));
    }

    const directRoomIds = yield Room.getAllDirectRoomIds(_id);

    directRoomIds.map(room => {
      io.to(room.user_id).emit('update_direct_room_info', {
        _id: room._id,
        name: data_changed.data.name,
        avatar: data_changed.data.avatar,
      });
      io.to(room.user_id).emit('update_user_info_in_list_contacts', { user_id: _id, data: data_changed.data });
    });

    const roomMychatId = yield Room.getRoomMyChatId(_id);

    io.to(_id).emit('update_user_avatar', { room_mychat_id: roomMychatId[0]._id, avatar: data_changed.data.avatar });
    io.emit('update_user_info', { user });

    return res.status(200).json({ success: true, msg: __('update_to_success_user') });
  } catch (e) {
    return res.status(500).json({ success: false, msg: __('update_to_fail_user') });
  }
});

exports.signin = function() {};

/**
 * Auth callback
 */

exports.authCallback = login;

/**
 * Show login form
 */

exports.login = function(req, res) {
  res.render('users/login', {
    title: 'Login',
  });
};

/**
 * Show sign up form
 */

exports.signup = function(req, res) {
  res.render('users/signup', {
    title: 'Sign up',
    user: new User(),
  });
};

exports.apiSignup = function(req, res) {
  const errors = validationResult(req);

  if (errors.array().length > 0) {
    let customErrors = customMessageValidate(errors);

    return res.status(422).json(customErrors);
  }

  const { email, name, username, password } = req.body;

  const active_token = crypto.randomBytes(20).toString('hex');

  const user = new User({
    name,
    email,
    username,
    password,
    active_token,
  });

  user.save(err => {
    if (err) {
      res.status(500).json({
        error: req.__('register_failed'),
      });
    }

    mailer
      .activeEmail(user)
      .then(result => res.status(200).json({ msg: result }))
      .catch(err => channel.error(err.toString()));
  });
};

/**
 *  Confirm Email
 */
exports.confirmEmail = function(req, res) {
  const { userId, active_token } = req.params;

  User.findById(userId)
    .then(user => {
      if (!user) {
        res.status(401).json({ msg: __('mail.couldNotFind') });
      } else if (user.active) {
        res.status(200).json({ msg: __('mail.alreadyConfirmed') });
      }

      if (active_token !== user.active_token) {
        res.status(401).json({ msg: __('token_invalid') });
      }

      if (new Date(user.active_token_expire) < new Date()) {
        res
          .status(412)
          .json({ msg: __('mail.expired_token'), resend_email: true, user_id: userId, active_token: active_token });
      }

      user.active = true;
      user.active_token = null;
      user.active_token_expire = null;
      user.save();

      Room.createMyChat(user._id);

      res.status(200).json({ msg: __('mail.confirmed') });
    })
    .catch(err => {
      channel.error(err);

      return res.status(500).json({ msg: __('mail.confirm_failed') });
    });
};

/**
 * Logout
 */

exports.logout = function(req, res) {
  req.logout();
  res.redirect('/login');
};

/**
 * Session
 */
exports.session = login;

function customMessageValidate(errors) {
  let customErrors = { ...errors.array() };
  for (let i in customErrors) {
    let param = customErrors[i].param;

    if (customErrors[param] == undefined) {
      customErrors[param] = '';
    } else {
      customErrors[param] += ', ';
    }

    customErrors[param] += customErrors[i].msg;
    delete customErrors[i];
  }

  return customErrors;
}

/**
 * Login
 */
function login(req, res) {
  const redirectTo = req.session.returnTo ? req.session.returnTo : '/';
  delete req.session.returnTo;
  res.redirect(redirectTo);
}

/*
 * Handle validate
 */
function handleValidate(req, res) {
  const errors = validationResult(req);

  if (errors.array().length > 0) {
    res.status(422).json(customMessageValidate(errors));

    return false;
  }

  return true;
}

/*
 * Make token to reset password
 */
function makeTokenResetPassword(plainText) {
  return crypto
    .createHash('sha256')
    .update(plainText)
    .digest('base64');
}

/**
 * Hello from other app
 */
exports.hello = function(req, res) {
  res.json({ sayHi: 'hello from server, nice to meet you!' });
};

exports.apiLogin = async(function*(req, res) {
  const { email, password } = req.body;
  const criteria = {
    email: email,
  };

  try {
    var user = yield User.load({ criteria });

    if (user == null || !user.authenticate(password) || !user.active) {
      return res.status(401).json({
        message: __('login.fail'),
      });
    }

    return res.status(200).json({
      message: __('login.success'),
      token: userMiddleware.generateJWTToken(user),
    });
  } catch (err) {
    channel.error(err);

    return res.status(401).json({
      message: __('login.fail'),
    });
  }
});

exports.contactRequest = async(function*(req, res) {
  let { _id } = req.decoded;
  const page = (req.query.page > 0 ? req.query.page : 1) - 1;
  const limit = config.LIMIT_ITEM_SHOW.REQUEST_CONTACT;
  const options = {
    limit: limit,
    page: page,
  };
  const contact = yield User.getMyContactRequest(_id, options);
  return res.status(200).json({ result: contact[0]['requested_in_comming'] });
});

exports.getReceivedRequestCount = async(function*(req, res) {
  let { _id } = req.decoded;
  const receivedRequestCount = yield User.getReceivedRequestCount(_id);
  return res.json({ result: receivedRequestCount });
});

exports.userSearch = async(function*(req, res) {
  if (handleValidate(req, res) === false) {
    return res;
  }

  let { searchText } = req.query;
  let userId = req.decoded._id;

  const listRequestAccept = yield User.getListRequestedMakeFriend(userId); // they send me a friend
  const listSendRequested = yield User.getSendRequestMakeFriend(userId); // send a friend to them
  const friendIds = yield User.getListContactIds({ userId }); // made friends

  let page = (req.query.page > 0 ? req.query.page : 1) - 1;
  let limit = config.LIMIT_ITEM_SHOW.CONTACT;
  let listUserIdsIgnore = [userId];

  friendIds.map((item, key) => {
    return listUserIdsIgnore.push(item.members[0].user.toString());
  });

  let options = {
    limit,
    page,
    searchText,
    listUserIdsIgnore,
  };
  const listSearch = yield User.getSearchContactByName(options);
  const data = contact.getListRequestFriend(listSearch, listRequestAccept.requested_in_comming, listSendRequested);

  return res.status(200).json({ result: data });
});

async function updateSentRequestCount(io, userId) {
  let sentRequestCount = await User.getRequestSentContactCount(userId);
  io.to(userId).emit('update_sent_request_count', sentRequestCount);
}

async function updateReceivedRequestCount(io, userId) {
  let receivedRequestCount = await User.getReceivedRequestCount(userId);
  io.to(userId).emit('update_received_request_count', receivedRequestCount);
}

exports.sendRequestContact = async(function*(req, res) {
  let userIdReceive = req.body.userId;
  let userIdSend = req.decoded._id;
  const io = req.app.get('socketIO');

  try {
    yield User.updateRequestFriend(userIdReceive, userIdSend);

    let userJustAdd = yield User.getInfoUser(userIdReceive);
    io.to(userIdSend).emit('add_to_list_sent_requests', userJustAdd);
    let senderRequest = yield User.getInfoUser(userIdSend);
    io.to(userIdReceive).emit('add_to_list_received_requests', senderRequest);
    updateSentRequestCount(io, userIdSend);
    updateReceivedRequestCount(io, userIdReceive);

    return res.status(200).json({
      success: __('contact.send_request.success'),
    });
  } catch (err) {
    channel.error(err);

    return res.status(500).json({
      error: __('contact.send_request.failed'),
    });
  }
});

/**
 *  Change password
 */
exports.apiChangePassword = async(function*(req, res) {
  const { current_password, new_password, confirm_password } = req.body;
  const criteria = { _id: req.decoded._id };

  try {
    var user = yield User.load({ criteria });

    if (handleValidate(req, res) === false) {
      return res;
    }

    if (!user) {
      return res.status(401).json({
        error: __('change_password.user_not_found'),
      });
    }

    if (!user.authenticate(current_password)) {
      return res.status(422).json({
        error: __('change_password.old_password_incorrect'),
      });
    }

    if (new_password === current_password) {
      return res.status(422).json({
        error: __('change_password.compare_current_and_new_password_failed'),
      });
    }

    user.updatePassword(new_password);
    return res.status(200).json({
      success: __('change_password.update_successfully'),
    });
  } catch (err) {
    channel.error(err);

    return res.status(500).json({
      error: __('change_password.change_password_failed'),
    });
  }
});

exports.apiSendMailResetPassword = async(function*(req, res) {
  if (handleValidate(req, res) === false) {
    return res;
  }

  const { email } = req.body;
  const criteria = {
    email: email,
  };
  try {
    var user = yield User.load({ criteria });

    if (user == null) {
      // TODO log action
      return res.status(200).json({
        message: __('reset_password.send_email'),
      });
    }

    var tokenResetPw = crypto.randomBytes(10).toString('hex');
    var hashTokenResetPw = makeTokenResetPassword(tokenResetPw);
    var resetTokenExpire = moment().add(parseInt(process.env.RESET_PW_TTL), 'hours');
    var updateToken = {
      reset_token: hashTokenResetPw,
      reset_token_expire: resetTokenExpire,
    };

    // Update token in database
    yield User.updateOne(criteria, updateToken);

    // Send mail to reset password
    mailer
      .resetPassword(user, tokenResetPw)
      .then(result => {
        return res.status(200).json({ message: result });
      })
      .catch(err => {
        throw new Error(err.toString());
      });
  } catch (err) {
    channel.error(err);

    return res.status(500).json({
      error: __('reset_password.send_email_error'),
    });
  }
});

exports.apiResetPassword = async(function*(req, res) {
  if (handleValidate(req, res) === false) {
    return res;
  }

  const { token, password } = req.body;
  const criteria = {
    reset_token: makeTokenResetPassword(token),
  };

  try {
    var user = yield User.load({ criteria });

    if (user == null) {
      return res.status(401).json({
        error: __('token_invalid'),
      });
    }

    var expireToken = new Date(user.reset_token_expire);
    var now = new Date(Date.now());

    if (expireToken < now) {
      return res.status(401).json({
        error: __('token_expired'),
      });
    }

    user.resetPassword(password);

    return res.status(200).json({
      message: __('reset_password.success'),
    });
  } catch (err) {
    channel.error(err);

    return res.status(500).json({
      error: __('token_invalid'),
    });
  }
});

exports.rejectContact = async(function*(req, res) {
  let { _id } = req.decoded;
  const { rejectContactIds } = req.body;
  const io = req.app.get('socketIO');

  try {
    yield User.updateOne(
      {
        _id: _id,
      },
      {
        $pull: {
          requested_in_comming: {
            $in: rejectContactIds,
          },
        },
      }
    );

    updateReceivedRequestCount(io, _id);
    io.to(_id).emit('remove_from_list_received_requests', rejectContactIds);

    rejectContactIds.forEach(rejectContactId => {
      io.to(rejectContactId).emit('remove_from_list_sent_requests', _id);
      updateSentRequestCount(io, rejectContactId);
    });

    return res.status(200).json({
      success: __('contact.reject.success'),
    });
  } catch (err) {
    channel.error(err);

    return res.status(500).json({
      error: __('contact.reject.fail'),
    });
  }
});

exports.acceptContact = async(function*(req, res) {
  let acceptUserIds = req.body;
  let { _id } = req.decoded;
  const io = req.app.get('socketIO');
  try {
    yield User.acceptRequest(_id, acceptUserIds);

    updateReceivedRequestCount(io, _id);
    io.to(_id).emit('remove_from_list_received_requests', acceptUserIds);
    acceptUserIds.forEach(acceptUserId => {
      io.to(acceptUserId).emit('remove_from_list_sent_requests', _id);
      updateSentRequestCount(io, acceptUserId);
    });

    let roomInfos = yield Room.getDirectRoomInfo(_id, acceptUserIds);
    roomInfos.forEach(roomInfo => {
      io.to(roomInfo.receiver_id).emit('add_to_list_rooms', roomInfo.sender);
      io.to(roomInfo.sender_id).emit('add_to_list_rooms', roomInfo.receiver);

      io.to(roomInfo.receiver_id).emit('add_to_list_contacts', roomInfo.sender);
      io.to(roomInfo.sender_id).emit('add_to_list_contacts', roomInfo.receiver);
    });

    return res.status(200).json({
      success: __('contact.accept.success'),
    });
  } catch (err) {
    channel.error(err);

    return res.status(500).json({
      error: __('contact.accept.failed'),
    });
  }
});

exports.listContacts = async(function*(req, res) {
  const { _id } = req.decoded;
  const searchText = req.query.searchText.trim().replace(/\s+/g, ' ');
  const getListFlag = true;
  let options = {
    userId: _id,
    searchText,
  };

  if (req.query.limit) {
    options.limit = parseInt(req.query.limit);
  } else {
    options.page = (req.query.page > 0 ? req.query.page : 1) - 1;
    options.limit = config.LIMIT_ITEM_SHOW.CONTACT;
  }

  try {
    const contacts = yield User.getListContacts(options, getListFlag);
    const totalContact = yield User.getListContacts(options);

    if (totalContact.length === 0) {
      totalContact.push({ number_of_contacts: 0 });
    }

    return res.status(200).json({
      totalContact: totalContact[0].number_of_contacts,
      result: contacts,
    });
  } catch (err) {
    channel.error(err);

    return res.status(500).json({
      error: __('contact.list.failed'),
    });
  }
});

exports.resendActiveEmail = async(function*(req, res) {
  const { _id, active_token } = req.body;
  const criteria = {
    _id,
    active_token,
  };

  try {
    const user = yield User.load({ criteria });

    if (!user) {
      return res.status(401).json({
        error: __('token_invalid'),
      });
    }

    if (user.active) {
      return res.status(401).json({
        error: __('mail.resend_active_email.account_have_active'),
      });
    }

    const resetActiveToken = crypto.randomBytes(20).toString('hex');
    const resetTokenExpire = moment().add(parseInt(process.env.ACTIVE_TOKEN_EXPIRE_TIME), 'days');
    user.active_token = resetActiveToken;
    user.active_token_expire = resetTokenExpire;
    user.save();

    mailer
      .activeEmail(user, true)
      .then(result => {
        return res.status(200).json({ message: result });
      })
      .catch(err => {
        throw new Error(err.toString());
      });
  } catch (err) {
    channel.error(err);

    return res.status(500).json({
      error: __('mail.resend_active_email.failed'),
    });
  }
});

exports.deleteContact = async(function*(req, res) {
  const { contactId } = req.body;
  const { _id } = req.decoded;
  const io = req.app.get('socketIO');
  try {
    let room = yield User.deleteContact(_id, contactId);

    io.to(_id).emit('remove_from_list_rooms', { roomId: room._id });
    io.to(contactId).emit('remove_from_list_rooms', { roomId: room._id });
    return res.status(200).json({
      success: __('contact.delete_contact.success'),
    });
  } catch (err) {
    channel.error(err);

    res.status(500).json({
      error: __('contact.delete_contact.failed'),
    });
  }
});

exports.getListSentRequestContacts = async function(req, res) {
  const { _id } = req.decoded;

  try {
    let listSentRequestContacts = await User.getSendRequestMakeFriend(_id);
    return res.status(200).json({
      success: __('contact.list-request-sent-contact.success'),
      result: listSentRequestContacts,
    });
  } catch (err) {
    res.status(500).json({
      error: __('contact.list-request-sent-contact.failed'),
    });
  }
};

exports.deleteSentRequestContact = async function(req, res) {
  let { _id } = req.decoded;
  const { requestSentContactId } = req.body;
  const io = req.app.get('socketIO');

  try {
    await User.deleteSentRequestContact(_id, requestSentContactId);
    io.to(_id).emit('remove_from_list_sent_requests', requestSentContactId);
    updateSentRequestCount(io, _id);
    updateReceivedRequestCount(io, requestSentContactId);
    io.to(requestSentContactId).emit('remove_from_list_received_requests', [_id]);

    return res.status(200).json({
      success: __('contact.delete-request-sent-contact.success'),
    });
  } catch (err) {
    channel.error(err);

    return res.status(500).json({
      error: __('contact.delete-request-sent-contact.fail'),
    });
  }
};

exports.getRequestSentContactsCount = async function(req, res) {
  const { _id } = req.decoded;
  try {
    let requestSentContactsCount = await User.getRequestSentContactCount(_id);
    return res.status(200).json({
      result: requestSentContactsCount,
    });
  } catch (err) {
    channel.error(err);

    res.status(500).json({
      error: __('failed'),
    });
  }
};
