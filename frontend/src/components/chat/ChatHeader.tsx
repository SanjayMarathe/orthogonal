import { PageHeader } from "./PageHeader";

type ChatHeaderProps = {
  title: string;
};

export function ChatHeader({ title }: ChatHeaderProps) {
  return <PageHeader title={title} />;
}
