/* Firebase web configuration.

   Unlike the Mapbox token in token.js, these values are NOT secret and are
   meant to ship in the page. They only name which Firebase project to talk
   to; what anyone is allowed to read or write is decided by the security
   rules in firestore.rules and by the list of authorised domains in the
   Firebase console — never by keeping this file hidden.

   While this is null, sign-in stays switched off and the app behaves exactly
   as it always has: everything on the phone, nothing sent anywhere.

   To switch it on, follow docs/SIGN-IN-SETUP.md and paste the config object
   Firebase gives you in place of null. */
export const firebaseConfig = null;

/* Flip to true once "Sign in with Apple" is set up in your Apple Developer
   account and enabled in Firebase. Until then the Apple button stays hidden
   rather than offering something that cannot work. */
export const appleSignInEnabled = false;
