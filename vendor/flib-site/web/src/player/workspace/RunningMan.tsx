import React from 'react';

interface Props {
  /** Animate a run cycle when true; show a seated pose when false. */
  running: boolean;
  color: string;
  /** Outer size in px. The SVG scales to fit. */
  size?: number;
}

// Stick figure that runs during playback and sits while paused. Designed
// for the Blueprint playhead crosshair circle. All geometry uses SVG paths
// so it stays crisp at any scale; the run cycle is driven by a single CSS
// keyframe alternating two arm/leg poses via step-end timing.
export const RunningMan: React.FC<Props> = ({ running, color, size = 14 }) => {
  if (!running) {
    // Seated pose — legs bent 90° at the knee, back slightly leaned.
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" style={{ overflow: 'visible' }}>
        <circle cx="7" cy="3" r="1.6" fill={color} />
        <line x1="7" y1="4.6" x2="7" y2="9" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
        {/* arms relaxed */}
        <line x1="7" y1="6" x2="4.5" y2="8" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
        <line x1="7" y1="6" x2="9.5" y2="8" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
        {/* seat line */}
        <line x1="5" y1="9.2" x2="9" y2="9.2" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
        {/* bent legs */}
        <line x1="7" y1="9" x2="5" y2="11" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
        <line x1="5" y1="11" x2="5" y2="13" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
        <line x1="7" y1="9" x2="9" y2="11" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
        <line x1="9" y1="11" x2="9" y2="13" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  }
  // Running pose — arms and legs alternate via a 2-step animation.
  return (
    <>
      <style>{`
        @keyframes rm-poseA { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
        @keyframes rm-poseB { 0%, 49% { opacity: 0 } 50%, 100% { opacity: 1 } }
      `}</style>
      <svg width={size} height={size} viewBox="0 0 14 14" style={{ overflow: 'visible' }}>
        <circle cx="7" cy="2.5" r="1.6" fill={color} />
        <line x1="7" y1="4.1" x2="7" y2="9" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
        {/* Pose A — left arm forward, right leg forward */}
        <g style={{ animation: 'rm-poseA 0.36s step-end infinite' }}>
          <line x1="7" y1="5.4" x2="4.4" y2="7" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
          <line x1="7" y1="5.4" x2="9.2" y2="4.2" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
          <line x1="7" y1="9" x2="4.4" y2="12.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
          <line x1="7" y1="9" x2="9.5" y2="11" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
        </g>
        {/* Pose B — right arm forward, left leg forward */}
        <g style={{ animation: 'rm-poseB 0.36s step-end infinite' }}>
          <line x1="7" y1="5.4" x2="9.6" y2="7" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
          <line x1="7" y1="5.4" x2="4.8" y2="4.2" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
          <line x1="7" y1="9" x2="9.6" y2="12.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
          <line x1="7" y1="9" x2="4.5" y2="11" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
        </g>
      </svg>
    </>
  );
};
