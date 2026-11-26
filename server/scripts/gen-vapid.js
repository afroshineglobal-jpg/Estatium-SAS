'use strict';
// Prints a fresh VAPID key pair as env lines. Run once; paste the three lines into /etc/estatium/estatium.env.
const webpush = require('web-push');
const k = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\nVAPID_SUBJECT=mailto:afroshineglobal@gmail.com`);
