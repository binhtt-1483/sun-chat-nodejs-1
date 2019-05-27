'use strict';

const express = require('express');
const router = express.Router();

// Require controller
const auth = require('../app/controllers/auth/authController');

//controller
const users = require('../app/controllers/users');
const roomsController = require('../app/controllers/rooms');
const roomAuthorization = require('../config/middlewares/authorization.js');
//validation
const usersValidate = require('../app/validations/users.js');
const roomsValidate = require('../app/validations/rooms.js');

// Change language
router.get('/language/:lang', (req, res) => {
  let { lang } = req.params;
  res.cookie('lang', lang, { maxAge: 900000, httpOnly: true });
  res.status(200).json({ msg: __('changed_lang', { lang: lang }) });
});

// Users
router.post('/login', users.apiLogin);
router.post('/signup', usersValidate.validate('register'), users.apiSignup);
router.get('/confirm/:userId/:active_token', users.confirmEmail);
//Contact
router.get('/my-contact-request', auth.jwtMiddleware, users.contactRequest);
router.get('/my-contact-request-number', auth.jwtMiddleware, users.totalContactRequest);
router.post('/reject-contact', auth.jwtMiddleware, users.rejectContact);
router.post('/accept-contact', auth.jwtMiddleware, users.acceptContact);
router.get('/contacts', auth.jwtMiddleware, users.listContacts);
router.get('/contacts-number', auth.jwtMiddleware, users.totalContact);
router.delete('/delete-contact', auth.jwtMiddleware, users.deleteContact);

router.get('/members/rooms', [auth.jwtMiddleware, roomAuthorization.showMember], roomsController.getMemberOfRoom);

router.post(
  '/send-mail-reset-password',
  usersValidate.validate('sendMailResetPassword'),
  users.apiSendMailResetPassword
);
router.post('/reset-password', usersValidate.validate('resetPassword'), users.apiResetPassword);

router.param('userId', users.load);
router.post('/change_password', auth.jwtMiddleware, usersValidate.validate('change_password'), users.apiChangePassword);
router.post('/resend-active-email', users.resendActiveEmail);

router.get('/users', auth.jwtMiddleware, users.show);
router.post('/update/user', auth.jwtMiddleware, usersValidate.validate('update'), users.update);

//Rooms
router.get('/rooms/index', auth.jwtMiddleware, roomsController.index);
router.get('/rooms/get-total-rooms-by-user', auth.jwtMiddleware, roomsController.getQuantityRoomsByUserId);
router.post('/create-room', auth.jwtMiddleware, roomsValidate.validate('create'), roomsController.createRoom);
router.delete('/delete-room', [auth.jwtMiddleware, roomAuthorization.checkAdmin], roomsController.deleteRoom);

module.exports = router;
