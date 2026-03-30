import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';

export const protect = async (req: Request, res: Response, next: NextFunction) => {
  let token;

  // Check header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } 
  // Check cookie
  else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (token) {
    try {
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'secret');
      console.log(`[AUTH-MW] Token found for ID: ${decoded.id}. Verified: ${decoded.twoFactorVerified}. Pending: ${decoded.twoFactorPending}`);
      
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        console.log(`[AUTH-MW] User ID ${decoded.id} not found in DB.`);
        throw new Error('User not found');
      }

      if (user.twoFactorEnabled && !decoded.twoFactorVerified) {
        console.log(`[AUTH-MW] 2FA Enabled but not verified in token. Redirecting.`);
        if (req.headers.accept && req.headers.accept.includes('text/html')) {
          return res.redirect('/auth/2fa');
        }
        return res.status(403).json({ message: '2FA verification required' });
      }

      if (decoded.twoFactorPending) {
        console.log(`[AUTH-MW] Token is PENDING. Redirecting to 2FA page.`);
        if (req.headers.accept && req.headers.accept.includes('text/html')) {
          return res.redirect('/auth/2fa');
        }
        return res.status(403).json({ message: '2FA pending' });
      }

      console.log(`[AUTH-MW] Authorized access for user: ${user.email}`);
      req.user = user;
      return next();
    } catch (error) {
       console.log(`[AUTH-MW] Auth failed: ${error}`);
       if (req.headers.accept && req.headers.accept.includes('text/html')) {
         return res.redirect('/auth/login');
       }
       return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    console.log(`[AUTH-MW] No token found. Redirecting to login.`);
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
        return res.redirect('/auth/login');
    }
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};
