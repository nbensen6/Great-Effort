import React from 'react';

function VideoBackground({ videoSrc, children }) {
  return (
    <div className="video-background-container">
      <video
        autoPlay
        loop
        muted
        playsInline
        className="video-background"
      >
        <source src={videoSrc} type="video/mp4" />
      </video>
      <div className="video-overlay" />
      <div className="video-content">
        {children}
      </div>
    </div>
  );
}

export default VideoBackground;
