import { ScreenPlaceholder } from '@/components/ScreenPlaceholder'

export default async function E5Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ScreenPlaceholder id="E5" param={id} />
}
