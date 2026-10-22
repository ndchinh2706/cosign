import { ScreenPlaceholder } from '@/components/ScreenPlaceholder'

export default async function L4DPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  return <ScreenPlaceholder id="L4D" param={username} />
}
