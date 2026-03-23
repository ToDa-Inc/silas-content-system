const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY || "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"
});

const audioPath = process.argv[2] || path.join(__dirname, 'data/frames/talking_head_test/audio.mp3');

async function transcribe() {
  console.log('🎙️ Transcribing audio...');
  
  try {
    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: "whisper-1",
      language: "de",
      response_format: "text"
    });
    
    console.log('\n📝 TRANSCRIPT:');
    console.log('='.repeat(50));
    console.log(transcript);
    console.log('='.repeat(50));
    
    // Save to file
    const outputPath = audioPath.replace('.mp3', '_transcript.txt');
    fs.writeFileSync(outputPath, transcript);
    console.log(`\n💾 Saved to: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

transcribe();