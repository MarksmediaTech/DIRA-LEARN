// Harness with the Import learners page as released on 21 Nov 2026 (before-22nov/), to reproduce the reported error.
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ImportPage } from './before-22nov/ImportPage';
createRoot(document.getElementById('root')!).render(<AuthProvider><BrowserRouter><Routes><Route path="/import" element={<ImportPage />} /></Routes></BrowserRouter></AuthProvider>);
