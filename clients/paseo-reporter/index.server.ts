import type { PluginServerContext } from '@getpaseo/plugin/server';
import { latestTextReply } from './server/inspect.js';
import { reportCompletedText, retryPendingReports } from './server/reporter.js';

export default function contribute(server: PluginServerContext) {
  // Retry reports left in the durable outbox by an earlier network or daemon failure.
  retryPendingReports();
  const interval = setInterval(retryPendingReports, 60_000);
  interval.unref();

  const remove = server.addHook('agent.turn.after', async (event, context) => {
    if (event.outcome.kind !== 'completed') return;

    const agent = context.paseo.agents.ref(event.agent.id);
    const page = await agent.timeline.refetch({ direction: 'tail', limit: 100 });
    const reply = latestTextReply(page.entries.map(({ item }) => item));
    if (reply) await reportCompletedText(event.agent, event.turnId, reply);
  });

  return () => {
    clearInterval(interval);
    remove();
  };
}
