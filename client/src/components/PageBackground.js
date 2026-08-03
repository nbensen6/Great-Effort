import React from 'react';

// Static page shell. This replaced per-page looping videos: they cost ~109MB of
// assets for a background that sat behind opaque cards, and the Riot-inspired
// look leans on flat dark surfaces with one red accent instead of motion.
function PageBackground({ children }) {
  return (
    <div className="page-background">
      <div className="page-background-art" aria-hidden="true" />
      <div className="page-content">{children}</div>
    </div>
  );
}

export default PageBackground;
