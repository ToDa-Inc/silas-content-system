import { Composition, registerRoot } from 'remotion';
import CardBrollSimple from './compositions/CardBrollSimple';

registerRoot(() => (
  <Composition
    id="card-captions-only"
    component={CardBrollSimple}
    durationInFrames={360}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{
      hook: 'Mitarbeiter: \u201EIch wei\u00DF, es ist schon 19 Uhr, aber wir m\u00FCssen kurz telefonieren? Es dauert nur 10 Minuten.\u201C',
      textBlocks: [
        {
          text: "❌ Dein Chef spricht über dich hinter verschlossenen Türen",
          appearAt: 60,
          duration: 300,
        },
        {
          text: "❌ Du wirst von wichtigen Meetings ausgeschlossen",
          appearAt: 120,
          duration: 240,
        },
        {
          text: "❌ Deine Kompetenz wird in Frage gestellt",
          appearAt: 180,
          duration: 180,
        },
        {
          text: "👇 Schreib 'Flaggen' für die volle Anleitung",
          appearAt: 270,
          duration: 90,
          isCTA: true,
        },
      ],
    }}
  />
));
