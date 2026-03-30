import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import User from '../models/User';

// ── Token helpers ──────────────────────────────────────────────────────────────

/** Full session token — only issued after 2FA is verified */
const generateSessionToken = (id: string) =>
  jwt.sign({ id, twoFactorVerified: true }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });

/** Short-lived pre-2FA token — marks password verified but 2FA pending */
const generatePending2FAToken = (id: string) =>
  jwt.sign({ id, twoFactorPending: true }, process.env.JWT_SECRET || 'secret', { expiresIn: '10m' });

// ── REGISTER ──────────────────────────────────────────────────────────────────

export const registerUser = async (req: Request, res: Response) => {
  const { username, email, password } = req.body;

  try {
    if (await User.findOne({ email })) {
      return res.status(400).redirect('/auth/register?error=exists');
    }

    // 1. Create user (no 2FA yet)
    const user = await User.create({ username, email, password });

    // 2. Generate a TOTP secret for them
    const secret = speakeasy.generateSecret({
      name: `KamiVault (${email})`,
      length: 20,
    });

    // 3. Store the secret (unencrypted — use field select:false for safety)
    await User.findByIdAndUpdate(user._id, {
      twoFactorSecret: secret.base32,
      twoFactorEnabled: false, // not enabled until they verify the first OTP
    });

    // 4. Generate QR code as a data URL
    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url!);

    // 5. Issue a "pending" token so the setup page is authenticated
    const pendingToken = generatePending2FAToken((user._id as any).toString());
    res.cookie('token', pendingToken, { httpOnly: true, maxAge: 10 * 60 * 1000 });

    // 6. Render 2FA setup page
    return res.render('2fa-setup', {
      title: '2FA Setup',
      qrDataUrl,
      secret: secret.base32,
      userId: user._id,
    });
  } catch (error: any) {
    console.error('Register Error:', error);
    res.status(500).redirect('/auth/register?error=server');
  }
};

// ── VERIFY 2FA SETUP (after registration) ─────────────────────────────────────

export const verify2FASetup = async (req: Request, res: Response) => {
  const { token: otpToken } = req.body;

  try {
    // Decode the pending token to get user id
    const pendingCookie = req.cookies?.token;
    if (!pendingCookie) return res.redirect('/auth/login?error=session');

    const decoded: any = jwt.verify(pendingCookie, process.env.JWT_SECRET || 'secret');
    if (!decoded.twoFactorPending) return res.redirect('/auth/login?error=session');

    // Re-fetch user with secret (select:false means we must explicitly include it)
    const user = await User.findById(decoded.id).select('+twoFactorSecret');
    if (!user || !user.twoFactorSecret) return res.redirect('/auth/register?error=setup');

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: otpToken,
      window: 1,
    });

    if (!verified) {
      // Regenerate QR so they can retry
      const secret = await User.findById(decoded.id).select('+twoFactorSecret');
      const qrDataUrl = await QRCode.toDataURL(
        speakeasy.otpauthURL({ secret: user.twoFactorSecret, label: user.email, encoding: 'base32' })
      );
      return res.render('2fa-setup', {
        title: '2FA Setup',
        qrDataUrl,
        secret: user.twoFactorSecret,
        userId: user._id,
        error: 'Code incorrect. Try again.',
      });
    }

    // Mark 2FA as fully enabled
    await User.findByIdAndUpdate(decoded.id, { twoFactorEnabled: true });

    // Issue full session token
    const sessionToken = generateSessionToken(decoded.id);
    res.cookie('token', sessionToken, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    return res.redirect('/users/dashboard');
  } catch (error: any) {
    console.error('2FA Setup Verify Error:', error);
    res.redirect('/auth/login?error=server');
  }
};

// ── LOGIN ─────────────────────────────────────────────────────────────────────

export const loginUser = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user || !(await user.comparePassword(password))) {
      return res.redirect('/auth/login?error=invalid');
    }

    if (user.twoFactorEnabled) {
      console.log(`[AUTH] User ${email} has 2FA enabled. Issuing pending token.`);
      const pendingToken = generatePending2FAToken((user._id as any).toString());
      res.cookie('token', pendingToken, { httpOnly: true, maxAge: 10 * 60 * 1000 });
      console.log(`[AUTH] Redirecting to /auth/2fa. Cookie set.`);
      return res.redirect('/auth/2fa');
    }

    // No 2FA — issue full token (legacy / users without 2FA)
    const sessionToken = generateSessionToken((user._id as any).toString());
    res.cookie('token', sessionToken, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    return res.redirect('/users/dashboard');
  } catch (error: any) {
    console.error('Login Error:', error);
    res.status(500).redirect('/auth/login?error=server');
  }
};

// ── VERIFY 2FA LOGIN ──────────────────────────────────────────────────────────

export const verify2FALogin = async (req: Request, res: Response) => {
  const { token: otpToken } = req.body;

  try {
    const pendingCookie = req.cookies?.token;
    if (!pendingCookie) return res.redirect('/auth/login?error=session');

    const decoded: any = jwt.verify(pendingCookie, process.env.JWT_SECRET || 'secret');
    if (!decoded.twoFactorPending) return res.redirect('/auth/login?error=session');

    const user = await User.findById(decoded.id).select('+twoFactorSecret');
    if (!user || !user.twoFactorSecret) return res.redirect('/auth/login?error=session');

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: otpToken,
      window: 1,
    });

    if (!verified) {
      return res.render('2fa-verify', {
        title: '2FA Verification',
        error: 'Invalid code. Please try again.',
      });
    }

    // Issue full session token
    const sessionToken = generateSessionToken((user._id as any).toString());
    res.cookie('token', sessionToken, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    return res.redirect('/users/dashboard');
  } catch (error: any) {
    console.error('2FA Login Verify Error:', error);
    res.redirect('/auth/login?error=server');
  }
};

// ── RENDER VIEWS ──────────────────────────────────────────────────────────────

export const renderLogin = (req: Request, res: Response) => {
  const error = req.query.error as string | undefined;
  const messages: Record<string, string> = {
    invalid: 'Invalid email or password.',
    session: 'Session expired. Please log in again.',
    server: 'Something went wrong. Please try again.',
  };
  res.render('login', { title: 'Sign In', errorMsg: error ? (messages[error] || null) : null });
};

export const renderRegister = (req: Request, res: Response) => {
  const error = req.query.error as string | undefined;
  const messages: Record<string, string> = {
    exists: 'An account with that email already exists.',
    server: 'Something went wrong. Please try again.',
  };
  res.render('register', { title: 'Create Account', errorMsg: error ? (messages[error] || null) : null });
};

export const render2FAVerify = (req: Request, res: Response) => {
  res.render('2fa-verify', { title: '2FA Verification', error: null });
};

// ── 2FA MANAGEMENT (Settings) ──────────────────────────────────────────────────

export const enable2FA = async (req: Request, res: Response) => {
  const user = await User.findById(req.user!._id);
  if (!user) return res.redirect('/auth/login');

  // Generate a TOTP secret for them
  const secret = speakeasy.generateSecret({
    name: `KamiVault (${user.email})`,
    length: 20,
  });

  // Store it (select:false safe)
  await User.findByIdAndUpdate(user._id, {
    twoFactorSecret: secret.base32,
    twoFactorEnabled: false, 
  });

  // Data for setup view
  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url!);
  
  // Issue a pending token so the setup page is authenticated for this action
  const pendingToken = generatePending2FAToken((user._id as any).toString());
  res.cookie('token', pendingToken, { httpOnly: true, maxAge: 10 * 60 * 1000 });

  return res.render('2fa-setup', {
    title: 'Security Setup',
    qrDataUrl,
    secret: secret.base32,
    userId: user._id,
  });
};

export const disable2FA = async (req: Request, res: Response) => {
  await User.findByIdAndUpdate(req.user!._id, {
    twoFactorEnabled: false,
    twoFactorSecret: undefined 
  });
  res.redirect('/users/profile');
};
