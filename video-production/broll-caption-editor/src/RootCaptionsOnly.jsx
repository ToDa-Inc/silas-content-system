import { Composition, registerRoot } from 'remotion';
import CaptionedBrollSimple from './compositions/CaptionedBrollSimple';

registerRoot(() => (
  <Composition
    id="captions-only"
    component={CaptionedBrollSimple}
    durationInFrames={360}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{
      hook: "Warnsignale die intelligente Mitarbeiter bemerken",
      textBlocks: [
        {
          text: "❌ Dein Chef spricht über dich hinter verschlossenen Türen",
          appearAt: 60, // 2 seconds
          duration: 300
        },
        {
          text: "❌ Du wirst von wichtigen Meetings ausgeschlossen",
          appearAt: 120, // 4 seconds
          duration: 240
        },
        {
          text: "❌ Deine Kompetenz wird in Frage gestellt",
          appearAt: 180, // 6 seconds
          duration: 180
        },
        {
          text: "👇 Schreib 'Flaggen' für die volle Anleitung",
          appearAt: 270, // 9 seconds
          duration: 90,
          isCTA: true
        }
      ]
    }}
  />
));
