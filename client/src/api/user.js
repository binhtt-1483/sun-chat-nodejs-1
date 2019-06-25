import Http from './../utils/Http';

export function getUser() {
  return new Http().authenticated().get('/users')
}

export function updateUser(param) {
  return new Http().authenticated().post('/update/user', param)
}
