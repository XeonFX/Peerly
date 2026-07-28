export type ReactionEmoji = {
  emoji: string
  keywords: readonly string[]
}

export type ReactionCategory = {
  id: string
  label: string
  reactions: readonly ReactionEmoji[]
}

export const QUICK_REACTIONS = ['❤️', '👍', '😂'] as const

export const REACTION_CATEGORIES: readonly ReactionCategory[] = [
  {
    id: 'people',
    label: 'Smileys & people',
    reactions: [
      { emoji: '😀', keywords: ['grin', 'happy', 'smile'] },
      { emoji: '😂', keywords: ['laugh', 'tears', 'funny'] },
      { emoji: '🤣', keywords: ['laugh', 'rolling', 'funny'] },
      { emoji: '😊', keywords: ['blush', 'happy', 'smile'] },
      { emoji: '😍', keywords: ['love', 'heart eyes'] },
      { emoji: '🥰', keywords: ['love', 'hearts'] },
      { emoji: '😎', keywords: ['cool', 'sunglasses'] },
      { emoji: '🤔', keywords: ['think', 'question'] },
      { emoji: '😮', keywords: ['wow', 'surprised'] },
      { emoji: '😢', keywords: ['cry', 'sad'] },
      { emoji: '😭', keywords: ['cry', 'sad', 'tears'] },
      { emoji: '😡', keywords: ['angry', 'mad'] },
      { emoji: '🤯', keywords: ['mind blown', 'wow'] },
      { emoji: '🫡', keywords: ['salute', 'respect'] },
    ],
  },
  {
    id: 'gestures',
    label: 'Gestures',
    reactions: [
      { emoji: '👍', keywords: ['thumb', 'up', 'like', 'yes'] },
      { emoji: '👎', keywords: ['thumb', 'down', 'dislike', 'no'] },
      { emoji: '👏', keywords: ['clap', 'applause'] },
      { emoji: '🙌', keywords: ['hooray', 'raised hands'] },
      { emoji: '🙏', keywords: ['thanks', 'please', 'pray'] },
      { emoji: '🤝', keywords: ['handshake', 'deal'] },
      { emoji: '💪', keywords: ['strong', 'muscle'] },
      { emoji: '👌', keywords: ['ok', 'perfect'] },
      { emoji: '✌️', keywords: ['peace', 'victory'] },
      { emoji: '👀', keywords: ['eyes', 'look'] },
    ],
  },
  {
    id: 'hearts',
    label: 'Hearts & symbols',
    reactions: [
      { emoji: '❤️', keywords: ['heart', 'love', 'red'] },
      { emoji: '🧡', keywords: ['heart', 'orange'] },
      { emoji: '💛', keywords: ['heart', 'yellow'] },
      { emoji: '💚', keywords: ['heart', 'green'] },
      { emoji: '💙', keywords: ['heart', 'blue'] },
      { emoji: '💜', keywords: ['heart', 'purple'] },
      { emoji: '💯', keywords: ['hundred', 'perfect'] },
      { emoji: '✅', keywords: ['check', 'done', 'yes'] },
      { emoji: '❌', keywords: ['cross', 'no', 'wrong'] },
      { emoji: '❓', keywords: ['question', 'help'] },
    ],
  },
  {
    id: 'celebration',
    label: 'Celebration & objects',
    reactions: [
      { emoji: '🎉', keywords: ['party', 'celebrate', 'confetti'] },
      { emoji: '🎊', keywords: ['party', 'celebrate'] },
      { emoji: '🔥', keywords: ['fire', 'hot'] },
      { emoji: '✨', keywords: ['sparkle', 'magic'] },
      { emoji: '⭐', keywords: ['star', 'favorite'] },
      { emoji: '🚀', keywords: ['rocket', 'launch'] },
      { emoji: '💡', keywords: ['idea', 'light'] },
      { emoji: '🏆', keywords: ['trophy', 'win'] },
      { emoji: '☕', keywords: ['coffee', 'break'] },
      { emoji: '🍕', keywords: ['pizza', 'food'] },
    ],
  },
]

export const ALLOWED_REACTIONS = new Set(
  REACTION_CATEGORIES.flatMap(category => category.reactions.map(reaction => reaction.emoji))
)

export function searchReactionCategories(
  query: string,
  categories: readonly ReactionCategory[] = REACTION_CATEGORIES
): ReactionCategory[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return [...categories]

  return categories.flatMap(category => {
    const reactions = category.reactions.filter(reaction =>
      reaction.emoji.includes(needle) ||
      reaction.keywords.some(keyword => keyword.toLocaleLowerCase().includes(needle))
    )
    return reactions.length > 0 ? [{ ...category, reactions }] : []
  })
}

export function buildReplyMessage(author: string, originalText: string, replyText: string): string {
  const excerpt = originalText.replace(/\s+/g, ' ').trim().slice(0, 180)
  return `↪ ${author}: ${excerpt}\n${replyText.trim()}`
}
