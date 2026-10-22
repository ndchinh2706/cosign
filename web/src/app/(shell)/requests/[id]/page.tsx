import { ScreenPlaceholder } from '@/components/ScreenPlaceholder'

export default async function E3Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ScreenPlaceholder id="E3" param={id} />
}
