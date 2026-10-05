#!/usr/bin/env node
/**
 * Creates (or resets) a Super Owner for the platform portal.
 *   PLATFORM_OWNER_PASSWORD='…' node scripts/create-platform-owner.js owner@yourcompany.com "Your Name"
 * The password is taken from the environment so it never lands in shell history / process list.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

(async () => {
  const [email, name = 'Platform Owner'] = process.argv.slice(2);
  const password = process.env.PLATFORM_OWNER_PASSWORD;
  if (!email || !password) { console.error('Usage: PLATFORM_OWNER_PASSWORD=… node scripts/create-platform-owner.js <email> [name]'); process.exit(2); }
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) { console.error('Password must be ≥12 chars with upper, lower and a digit'); process.exit(2); }
  const prisma = new PrismaClient();
  try {
    const hash = await bcrypt.hash(password, 12);
    const u = await prisma.platformUser.upsert({ where: { email: email.toLowerCase() }, update: { password: hash, isActive: true, role: 'SUPER_OWNER', tokenVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null }, create: { email: email.toLowerCase(), name, password: hash, role: 'SUPER_OWNER' } });
    console.log(`✅ Super Owner ready: ${u.email}`);
  } finally { await prisma.$disconnect(); }
})();
