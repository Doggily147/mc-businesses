// EmailJS configuration — fill these 3 in after the one-time setup at emailjs.com
// (See README.md → "Forgot Password (EmailJS) setup")
//
// PUBLIC_KEY  — EmailJS account → "Account" → "General" → Public Key
// SERVICE_ID  — EmailJS → "Email Services" → the Gmail service you connect → Service ID
// TEMPLATE_ID — EmailJS → "Email Templates" → the template you create → Template ID
//
// These are SAFE to commit publicly. EmailJS public key is meant to be in browser code.
window.EMAILJS_CONFIG = {
    PUBLIC_KEY:  'YOUR_PUBLIC_KEY_HERE',
    SERVICE_ID:  'YOUR_SERVICE_ID_HERE',
    TEMPLATE_ID: 'YOUR_TEMPLATE_ID_HERE',
    TO_EMAIL:    'isaac.huq@gmail.com'
};

// Initialize EmailJS as soon as the SDK is loaded
if (window.emailjs && window.EMAILJS_CONFIG.PUBLIC_KEY !== 'YOUR_PUBLIC_KEY_HERE') {
    emailjs.init({ publicKey: window.EMAILJS_CONFIG.PUBLIC_KEY });
}
