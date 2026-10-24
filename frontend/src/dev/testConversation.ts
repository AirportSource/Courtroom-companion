// TEMPORARY scripted conversation for testing dialogue timing, emotion switching and blips.
// Lines have no speaker, so they are spoken by whichever character the player selected.
// Emotions the character lacks fall back through the character's manifest.
import type { DialogueLine } from '../engine/dialogueTypes.ts'

export const TEST_CONVERSATION: DialogueLine[] = [
  { emotion: 'neutral', text: 'Hey! Can you hear me?' },
  { emotion: 'happy', text: 'Great! It looks like everything is working!' },
  { emotion: 'thinking', text: 'Hmm... maybe we should test something a little harder.' },
  { emotion: 'surprised', text: 'W-Wait! What was that?!' },
  { emotion: 'sad', text: 'Aw... I thought I had it figured out.' },
  // Long on purpose: should wrap onto exactly three lines of the dialogue box.
  { emotion: 'explaining', text: 'This line is long on purpose, so we can check how text wraps inside the box.' },
  { emotion: 'neutral', voice: 'blip_male', text: '(Testing the male voice blip on this line.)' },
  { emotion: 'laughing', text: 'Okay, that’s the end of the test! Advance to start over.' },
]
