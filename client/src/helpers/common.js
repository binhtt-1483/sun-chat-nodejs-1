import systemConfig from './../config/configServer';
const jwt = require('jsonwebtoken');

export function checkExpiredToken() {
  if (localStorage.getItem('token') == null) {
    return false;
  }
  let decoded = jwt.decode(localStorage.getItem('token'));
  let currentTime = Date.now() / 1000;

  if (parseFloat(decoded.exp) > parseFloat(currentTime)) {
    return true;
  }
  localStorage.removeItem('token');

  return false;
}

export function getUserAvatarUrl (avatar) {
  return `${systemConfig.USER_AVATAR_DIR}${avatar}`;
}

export function getRoomAvatarUrl (avatar) {
  return `${systemConfig.ROOM_AVATAR_DIR}${avatar}`;
}
