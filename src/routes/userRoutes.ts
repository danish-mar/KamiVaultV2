import { Router } from 'express';
import { getProfile, renderProfile, renderDashboard, renderScrolls, renderVault, renderSettings, renderManageScroll, renderDocumentDetail, renderScrollData, renderHowItWorks } from '../controllers/userController';
import { createScroll, uploadAnchor, uploadBatch, completeScroll, deleteScroll, shareScroll, revokeAccess, toggleDocumentFlag } from '../controllers/scrollController';
import { protect } from '../middleware/auth';
import multer from 'multer';
import os from 'os';

const upload = multer({ dest: os.tmpdir() });

const router = Router();

// API route
router.get('/profile-data', protect, getProfile);

// Render route
router.get('/profile', protect, renderProfile);
router.get('/dashboard', protect, renderDashboard);
router.get('/scrolls', protect, renderScrolls);
router.post('/scrolls', protect, createScroll);
router.get('/scrolls/:id', protect, renderManageScroll);
router.post('/scrolls/:id/anchor', protect, upload.single('anchor'), uploadAnchor);
router.post('/scrolls/:id/upload', protect, upload.array('documents', 50), uploadBatch);
router.post('/scrolls/:id/complete', protect, completeScroll);
router.post('/scrolls/:id/delete', protect, deleteScroll);
router.post('/scrolls/:id/share', protect, shareScroll);
router.post('/scrolls/:id/revoke', protect, revokeAccess);
router.post('/documents/:id/flag', protect, toggleDocumentFlag);
router.get('/documents/:id', protect, renderDocumentDetail);
router.get('/scrolls/:id/data', protect, renderScrollData);
router.get('/vault', protect, renderVault);
router.get('/settings', protect, renderSettings);
router.get('/how-it-works', protect, renderHowItWorks);

export default router;
