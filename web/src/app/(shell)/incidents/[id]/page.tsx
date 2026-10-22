import { ScreenPlaceholder } from '@/components/ScreenPlaceholder'

export default async function E2Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ScreenPlaceholder id="E2" param={id} />
}
