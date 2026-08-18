function kycVerified(user = {}) {
  if (user.role === 'admin') return true;
  if (!user.kycStatus) return true;
  return user.kycStatus === 'verified';
}

module.exports = { kycVerified };
