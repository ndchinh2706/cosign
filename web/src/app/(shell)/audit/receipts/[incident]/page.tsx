import { ScreenPlaceholder } from '@/components/ScreenPlaceholder'

export default async function C2Page({ params }: { params: Promise<{ incident: string }> }) {
  const { incident } = await params
  return <ScreenPlaceholder id="C2" param={incident} />
}
