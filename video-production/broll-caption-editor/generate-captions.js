#!/usr/bin/env node

/**
 * Caption Generator — Convert plain text to Remotion caption config
 *
 * Usage:
 *   node generate-captions.js "My Hook" "Text 1" "Text 2" "CTA"
 *
 * Example:
 *   node generate-captions.js "Content Types That Work" "Type Description Example" "Situational Time-specific" "Comment for info"
 *
 * Output: JSON config ready to paste into src/Root.jsx
 */

const hook = process.argv[2];
const textLines = process.argv.slice(3);

if (!hook || textLines.length === 0) {
  console.error('Usage: node generate-captions.js "Hook" "Line 1" "Line 2" "Line 3"');
  console.error('');
  console.error('Example:');
  console.error('  node generate-captions.js "Content Types That Work" "Type Description" "Situational" "Comment for info"');
  process.exit(1);
}

const fps = 30;
const delayBetweenSeconds = 2;
const delayFrames = delayBetweenSeconds * fps;

const config = {
  hook,
  textBlocks: textLines.map((text, index) => ({
    text,
    appearAt: delayFrames * (index + 1),
    duration: delayFrames
  }))
};

console.log('\n✅ Generated caption config:\n');
console.log(JSON.stringify(config, null, 2));
console.log('\n📋 Paste into src/Root.jsx defaultProps:\n');
console.log(`defaultProps={${JSON.stringify(config, null, 2)}}`);
console.log('\n');
