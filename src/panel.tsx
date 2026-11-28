import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  IconButton,
  List,
  ListItem,
  Row,
  Spinner,
  Stack,
  Text,
  atom,
  on,
  plugin,
  read,
  set,
  type PanelContext,
} from 'orca';

type ArtifactEntry = {
  title: string;
  root: string;
  skill: string;
  skillName: string;
};

type WsInfo = {
  name: string;
  root: string;
};

const openingAtom = atom(false);
const errorAtom = atom<string | null>(null);
const wsInfoAtom = atom<WsInfo>({ name: '', root: '' });
const itemsAtom = atom<ArtifactEntry[]>([]);

async function refresh(): Promise<void> {
  try {
    const status = (await plugin.request('studio.status')) as
      | { ok?: boolean; workspaceName?: string; workspaceRoot?: string }
      | null
      | undefined;
    if (status && status.ok) {
      set(wsInfoAtom, {
        name: String(status.workspaceName || ''),
        root: String(status.workspaceRoot || ''),
      });
    }
  } catch {
    // 面板刷新失败时不阻断渲染
  }

  try {
    const res = (await plugin.request('studio.skills')) as
      | {
          ok?: boolean;
          skills?: Array<{
            id: string;
            name: string;
            roots?: Array<{ title: string; root: string }>;
          }>;
        }
      | null
      | undefined;
    if (res && res.ok && Array.isArray(res.skills)) {
      const next: ArtifactEntry[] = [];
      for (const s of res.skills) {
        for (const r of s.roots || []) {
          if (!r || !r.root) continue;
          next.push({
            title: String(r.title || r.root),
            root: String(r.root),
            skill: String(s.id),
            skillName: String(s.name || s.id),
          });
        }
      }
      set(itemsAtom, next);
    }
  } catch {
    // 忽略列表加载异常
  }
}

async function openGallery(): Promise<void> {
  if (read(openingAtom)) return;
  set(openingAtom, true);
  set(errorAtom, null);
  try {
    const res = (await plugin.request('studio.gallery.open')) as
      | { ok?: boolean; error?: string }
      | null
      | undefined;
    if (!res?.ok) {
      set(errorAtom, String(res?.error || '打开项目库失败，请稍后重试'));
    }
  } catch (err) {
    set(errorAtom, String((err as Error)?.message || err || '打开项目库失败'));
  } finally {
    set(openingAtom, false);
  }
}

async function openArtifact(skill: string, root: string): Promise<void> {
  if (read(openingAtom)) return;
  set(openingAtom, true);
  set(errorAtom, null);
  try {
    const res = (await plugin.request('studio.skill.open', { skill, root })) as
      | { ok?: boolean; error?: string; tabError?: string }
      | null
      | undefined;
    if (!res?.ok) {
      set(errorAtom, String(res?.error || res?.tabError || '打开作品失败，请稍后重试'));
    }
  } catch (err) {
    set(errorAtom, String((err as Error)?.message || err || '打开作品失败'));
  } finally {
    set(openingAtom, false);
  }
}

export function setup(ctx: PanelContext): void {
  void refresh();
  ctx.subscriptions.push(
    on('workspace.changed', () => {
      void refresh();
    }),
  );
  ctx.subscriptions.push(
    plugin.on('studio.opening', (payload: unknown) => {
      const data = payload as { opening?: boolean } | null | undefined;
      set(openingAtom, Boolean(data?.opening));
    }),
  );
}

export default function StudioPanel() {
  const opening = read(openingAtom);
  const error = read(errorAtom);
  const ws = read(wsInfoAtom);
  const items = read(itemsAtom);

  return (
    <Stack gap="md">
      <Card
        title="Orca-Design 项目库"
        description={ws.name ? `当前工作区：${ws.name}` : '在主对话区域管理与编辑设计作品'}
      >
        <Stack gap="sm">
          <Row gap="sm" align="center" justify="between">
            <Row gap="sm" align="center">
              <Button
                variant="solid"
                tone="accent"
                icon="layers"
                disabled={opening}
                onPress={() => {
                  void openGallery();
                }}
              >
                {opening ? '正在打开项目库…' : '在主对话区打开项目库'}
              </Button>
              {opening ? <Spinner label="正在打开项目库" labelHidden /> : null}
            </Row>
            <IconButton
              icon="refresh"
              label="刷新列表"
              variant="ghost"
              disabled={opening}
              onPress={() => {
                void refresh();
              }}
            />
          </Row>
          {error ? (
            <Callout tone="danger" title="无法打开" icon="error">
              <Text size="sm">{error}</Text>
            </Callout>
          ) : null}
        </Stack>
      </Card>

      {items.length > 0 ? (
        <List label="当前工作区作品">
          {items.map((it) => (
            <ListItem
              key={it.root}
              title={it.title}
              description={it.skillName}
              icon="file"
              disabled={opening}
              onPress={() => {
                void openArtifact(it.skill, it.root);
              }}
            >
              <Badge tone="neutral">{it.skillName}</Badge>
            </ListItem>
          ))}
        </List>
      ) : (
        <EmptyState
          icon="layers"
          title="点击上方按钮进入项目库"
          description="支持画布、演示稿、设计系统、数据看板、动效、社媒卡片与长页排版。"
        />
      )}
    </Stack>
  );
}
