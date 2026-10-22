import { ScreenPlaceholder } from '@/components/ScreenPlaceholder'

export default async function A6Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ScreenPlaceholder id="A6" param={id} />
}
