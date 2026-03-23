/**
 * Caption Configuration
 *
 * Each caption preset defines:
 * - hook: Main headline (appears at 0s)
 * - textBlocks: Array of text that appears sequentially
 *   - text: The caption text
 *   - appearAt: Frame number (frame / fps = seconds)
 *   - duration: How long to display (in frames)
 *
 * At 30fps: 30 frames = 1 second
 */

export const PRESETS = {
  // Example 1: Content Types structure
  contentTypes: {
    hook: "Content Types That Work",
    textBlocks: [
      {
        text: "Type Description Example",
        appearAt: 60, // 2 seconds
        duration: 60
      },
      {
        text: "Situational Time-specific workplace moment",
        appearAt: 120, // 4 seconds
        duration: 60
      },
      {
        text: 'Comment "info" for full breakdown',
        appearAt: 180, // 6 seconds
        duration: 120
      }
    ]
  },

  // Example 2: Red flags pattern
  redFlags: {
    hook: "Red Flags Smart Employees Notice",
    textBlocks: [
      {
        text: "🚩 Your boss discusses you behind closed doors",
        appearAt: 60,
        duration: 60
      },
      {
        text: "🚩 You're excluded from important meetings",
        appearAt: 120,
        duration: 60
      },
      {
        text: "Act before it's too late",
        appearAt: 180,
        duration: 120
      }
    ]
  },

  // Example 3: Time-specific hook
  timeSpecific: {
    hook: "It's 4:55 PM Friday",
    textBlocks: [
      {
        text: "Your boss sends an urgent email",
        appearAt: 60,
        duration: 60
      },
      {
        text: "Here's what NOT to do...",
        appearAt: 120,
        duration: 120
      }
    ]
  }
};

/**
 * Generate a custom caption config
 * Usage: generateCaption("My Hook", ["Line 1", "Line 2", "CTA"], timingMs)
 */
export const generateCaption = (hook, textLines, delayBetweenMs = 2000) => {
  const fps = 30;
  const delayFrames = Math.round((delayBetweenMs / 1000) * fps);
  const displayFrames = delayFrames; // Show each for the same duration as delay

  return {
    hook,
    textBlocks: textLines.map((text, index) => ({
      text,
      appearAt: delayFrames * (index + 1),
      duration: displayFrames
    }))
  };
};

export default PRESETS;
