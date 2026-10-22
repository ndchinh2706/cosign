import { ScreenPlaceholder } from '@/components/ScreenPlaceholder'

export default async function L2Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ScreenPlaceholder id="L2" param={id} />
}
