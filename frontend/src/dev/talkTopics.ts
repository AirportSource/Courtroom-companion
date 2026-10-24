// Development-only sample topics for the Talk Options list. Character-neutral on purpose: the
// component is generic, and real topics will come from the conversation/case state later.
import type { TalkOption } from '../courtRecord/talkOptions.ts'

export const DEV_TALK_TOPICS: TalkOption[] = [
  { id: 'small_talk', label: 'Small talk', order: 0 },
  { id: 'about_today', label: 'About today', order: 1 },
  { id: 'the_case', label: 'The case', enabled: false, order: 2 },
  { id: 'something_new', label: 'Something new', isNew: true, order: 3 },
]
