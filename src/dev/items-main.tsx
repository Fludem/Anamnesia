import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ContactSheet } from './ContactSheet.tsx';
import '../styles.css';
import '../ui/theme/fonts.ts';
import './contact-sheet.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ContactSheet />
  </StrictMode>,
);
