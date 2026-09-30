export function getOwnerEmail() {
  return (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
}

export function isOwnerEmail(email, emailVerified = false) {
  const owner = getOwnerEmail();
  // Matching a self-reported address is not proof of ownership.
  if (!owner || !email || !(emailVerified === true || emailVerified === 1)) return false;
  return email.trim().toLowerCase() === owner;
}

export function roleLabel(isAdmin, isOwner = false) {
  if (isOwner) return 'Owner';
  if (isAdmin >= 3) return 'Admin';
  if (isAdmin >= 2) return 'Staff';
  if (isAdmin >= 1) return 'Mod';
  return 'User';
}
