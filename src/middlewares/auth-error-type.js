function tokenErrorType(error) {
  return error.name === 'TokenExpiredError' ? 'token_expired' : 'token_invalid';
}

module.exports = { tokenErrorType };
