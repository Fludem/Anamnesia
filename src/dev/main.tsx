import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { IconBrowser } from './IconBrowser.tsx';
import '../styles.css';
import './icon-browser.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IconBrowser />
  </StrictMode>,
);
