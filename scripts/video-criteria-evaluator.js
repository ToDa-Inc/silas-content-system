#!/usr/bin/env node
/**
 * Video Criteria Evaluator
 * 
 * Evaluates analyzed frames against the 5 outlier criteria
 * 
 * Usage:
 *   node scripts/video-criteria-evaluator.js --analysis data/frames/test_output/vision_analysis.json
 *   node scripts/video-criteria-evaluator.js --analysis data/frames/test_output/vision_analysis.json --verbose
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

function getArg(name, short = null) {
  const idx = args.indexOf(`--${name}`);
  const idxShort = short ? args.indexOf(`-${short}`) : -1;
  const actualIdx = idx !== -1 ? idx : idxShort;
  return actualIdx !== -1 ? args[actualIdx + 1] : null;
}

const analysisFile = getArg('analysis', 'a');
const verbose = getArg('verbose', 'v') === 'true';
const outputFile = getArg('output', 'o');

if (!analysisFile) {
  console.log('Usage: node scripts/video-criteria-evaluator.js --analysis <path> [--verbose]');
  console.log('Example: node scripts/video-criteria-evaluator.js --analysis data/frames/test_output/vision_analysis.json');
  process.exit(1);
}

// Read the vision analysis
const analysisPath = path.join(__dirname, '..', analysisFile);
if (!fs.existsSync(analysisPath)) {
  console.error(`❌ Analysis file not found: ${analysisPath}`);
  process.exit(1);
}

const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));

// The 5 core criteria definitions
const CRITERIA = {
  instantHook: {
    name: "Instant Hook (0-2 seconds)",
    description: "Video captures attention in 0-2 seconds with ultra-clear, specific hook",
    indicators: [
      "Time-specific (day, time, moment)",
      "Specific situation described",
      "Clear topic immediately understandable",
      "POV language (you/your)"
    ],
    check: (text, visual, scene) => {
      const t = (text || "").toLowerCase();
      const hasTime = /\d{1,2}:\d{2}|freitag|montag|mittwoch|donnerstag|samstag|sonntag/i.test(t);
      const hasSpecificSituation = t.length > 50; // Detailed description
      const hasPOV = /\b(du|deine|dein|dir|ich|meine)\b/i.test(t);
      const isShort = text && text.length < 200;
      
      let score = 0;
      if (hasTime) score += 3;
      if (hasSpecificSituation) score += 3;
      if (hasPOV) score += 2;
      if (isShort) score += 2;
      
      return { score: Math.min(score, 10), hasTime, hasSpecificSituation, hasPOV };
    }
  },
  
  highRelatability: {
    name: "High Relatability",
    description: "Viewer immediately thinks 'That happened to me'",
    indicators: [
      "Universal workplace situation",
      "Common frustration",
      "No abstract concepts - concrete scenario",
      "Emotional memory trigger"
    ],
    check: (text, visual, scene) => {
      const t = (text || "").toLowerCase();
      const workplaceWords = /arbeit|boss|chef|büro|meeting|email|kollegen|kollegin|urlaub|freitag|feierabend/i.test(t);
      const relatableSituation = /tasche|gepackt|dringend|vergessen|überstunden|stress/i.test(t);
      const noAbstract = !/\b(konzept|idee|prinzip|theorie)\b/i.test(t);
      
      let score = 0;
      if (workplaceWords) score += 3;
      if (relatableSituation) score += 4;
      if (noAbstract) score += 3;
      
      return { score: Math.min(score, 10), workplaceWords, relatableSituation };
    }
  },
  
  cognitiveTension: {
    name: "Cognitive Tension",
    description: "Creates curiosity or disagreement (Zeigarnik Effect)",
    indicators: [
      "Shows wrong answers before right",
      "Question at end",
      "Conflict word (urgent, warning, stop)",
      "Incomplete information"
    ],
    check: (text, visual, scene) => {
      const t = (text || "").toLowerCase();
      const hasWrongAnswers = /❌|anstatt|instead|wrong|nicht|don't/i.test(t);
      const hasQuestion = /\?|ist das|was|wie|warum|should|could|would/i.test(t);
      const conflictWord = /dringend|warnung|vorsicht|stop|achtung|warning|urgent|gefährlich/i.test(t);
      
      let score = 0;
      if (hasWrongAnswers) score += 4;
      if (hasQuestion) score += 3;
      if (conflictWord) score += 3;
      
      return { score: Math.min(score, 10), hasWrongAnswers, hasQuestion, conflictWord };
    }
  },
  
  clearValue: {
    name: "Clear Value",
    description: "Viewer gains insight, language, validation, or framework",
    indicators: [
      "Actionable script or phrases",
      "Framework or steps",
      "Specific words to use",
      "Validation of feelings"
    ],
    check: (text, visual, scene) => {
      const t = (text || "").toLowerCase();
      // This is harder to detect from frames alone - caption analysis would help
      const hasSteps = /\d+\.|schritt|step|first|second|third|1\)|2\)|3\)/i.test(t);
      const hasScript = /sagen|sag|antwort|response|sentence|phrase/i.test(t);
      
      let score = 0;
      if (hasSteps) score += 4;
      if (hasScript) score += 3;
      // Baseline value assumption (content provides some value)
      score += 3;
      
      return { score: Math.min(score, 10), hasSteps, hasScript };
    }
  },
  
  commentTrigger: {
    name: "Comment Trigger",
    description: "Creates discussion (questions, controversy, validation)",
    indicators: [
      "Direct question",
      "Controversial statement",
      "Validation of frustration",
      "Invitation to share"
    ],
    check: (text, visual, scene) => {
      const t = (text || "").toLowerCase();
      const hasDirectQuestion = /\?|ist das|was denkst|comment/i.test(t);
      const validationWords = /kennen|passiert|erlebt|been there|feeling|frustriert/i.test(t);
      const hasCTA = /folgen|follow|comment|save|share|kommentier/i.test(t);
      
      let score = 0;
      if (hasDirectQuestion) score += 4;
      if (validationWords) score += 3;
      if (hasCTA) score += 3;
      
      return { score: Math.min(score, 10), hasDirectQuestion, validationWords, hasCTA };
    }
  }
};

// Evaluate each frame
console.log(`\n🎯 VIDEO CRITERIA EVALUATOR`);
console.log(`   Analysis: ${analysisFile}`);
console.log(`   Frames: ${analysis.frameCount}`);
console.log('---');

const results = {
  analyzedAt: new Date().toISOString(),
  totalFrames: analysis.frameCount,
  criteria: {},
  totalScore: 0,
  maxScore: 50,
  interpretation: ""
};

// Check each criteria against all frames
for (const [key, criterion] of Object.entries(CRITERIA)) {
  console.log(`\n📋 ${criterion.name}`);
  
  let bestMatch = { score: 0, frame: null, details: {} };
  
  for (const frame of analysis.frames) {
    const { analysis: frameText, filename } = frame;
    
    // Extract components from analysis text
    const textMatch = analysisText => {
      const textSection = analysisText.match(/TEXT:\s*([\s\S]*?)(?=---|$)/i);
      return textSection ? textSection[1].trim() : "";
    };
    
    const visualMatch = analysisText => {
      const visualSection = analysisText.match(/VISUAL:\s*([\s\S]*?)(?=---|$)/i);
      return visualSection ? visualSection[1].trim() : "";
    };
    
    const sceneMatch = analysisText => {
      const sceneSection = analysisText.match(/SCENE:\s*([\s\S]*?)(?=---|$)/i);
      return sceneSection ? sceneSection[1].trim() : "";
    };
    
    const text = textMatch(frameText);
    const visual = visualMatch(frameText);
    const scene = sceneMatch(frameText);
    
    const checkResult = criterion.check(text, visual, scene);
    
    if (checkResult.score > bestMatch.score) {
      bestMatch = {
        score: checkResult.score,
        frame: filename,
        details: checkResult
      };
    }
    
    if (verbose) {
      console.log(`   ${filename}: ${checkResult.score}/10`);
    }
  }
  
  results.criteria[key] = {
    name: criterion.name,
    score: bestMatch.score,
    evidenceFrame: bestMatch.frame,
    details: bestMatch.details,
    description: criterion.description
  };
  
  console.log(`   → Best match: ${bestMatch.score}/10 (${bestMatch.frame})`);
  
  results.totalScore += bestMatch.score;
}

// Calculate percentage
const percentage = Math.round((results.totalScore / results.maxScore) * 100);

// Interpretation
if (percentage >= 80) {
  results.interpretation = "✅ HIGHLY REPLICABLE BLUEPRINT - Strong outlier pattern";
} else if (percentage >= 60) {
  results.interpretation = "✅ STRONG PATTERN - Adaptable for niche";
} else if (percentage >= 40) {
  results.interpretation = "⚠️ MODERATE PATTERN - Analyze further";
} else {
  results.interpretation = "❌ WEAK PATTERN - Not a strong outlier";
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('📊 SUMMARY');
console.log('='.repeat(50));
console.log(`Total Score: ${results.totalScore}/${results.maxScore} (${percentage}%)`);
console.log(`\nInterpretation: ${results.interpretation}`);
console.log('\nCriteria Breakdown:');

for (const [key, result] of Object.entries(results.criteria)) {
  const bar = '█'.repeat(result.score) + '░'.repeat(10 - result.score);
  console.log(`  ${result.name}: ${bar} ${result.score}/10`);
}

// Save results
const outputPath = outputFile 
  ? path.join(__dirname, '..', outputFile)
  : path.join(path.dirname(analysisPath), 'criteria_evaluation.json');

fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`\n💾 Evaluation saved to: ${outputPath}`);