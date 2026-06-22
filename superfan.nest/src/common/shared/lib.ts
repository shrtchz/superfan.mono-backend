export const generateReferralCode = (firstName: string): string => {
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${firstName}${random}`.toUpperCase();
};