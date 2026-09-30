export const LEGAL_VERSION = '2026-09-30-ad-free';
export const LEGAL_EFFECTIVE = 'September 30, 2026';
// Do not direct complaints about this independent deployment to upstream staff,
// or publish the owner's private account address as a contact by default.
export const LEGAL_CONTACT_EMAIL = process.env.CONTACT_EMAIL?.trim() || 'Not configured. See /edition for this independent deployment.';
export const LEGAL_DMCA_EMAIL = process.env.DMCA_EMAIL?.trim() || LEGAL_CONTACT_EMAIL;
export const LEGAL_DISCORD = process.env.COMMUNITY_URL?.trim() || 'No community channel configured for this independent edition.';
