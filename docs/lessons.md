# Lessons and troubleshooting

**Lessons & labs** in the menu lists troubleshooting scenarios. Each scenario is a network
with one or more faults in it, a briefing, hints and goals. The simulator checks the goals
automatically.

## For students

1. Open a scenario and choose **Start**. You get your own copy of the network; it also
   appears under Topologies.
2. Above the canvas the lesson bar shows the briefing and the goals. Fix the network with
   the console, the side panel and the simulation as usual.
3. **Check my work** saves the topology and runs every goal. A goal that fails says why
   (for example "No reply from 10.2.0.10").
4. **Hint** opens the next hint. Your teacher sees how many hints you used.
5. **Start again** puts the original network back. Hints you used stay counted.

The goals describe the working network, not the fix: every solution that reaches them
counts. Once all goals pass, the scenario is completed; it stays completed when you
continue experimenting.

## Built-in scenarios

| Scenario | Level | Topic |
| --- | --- | --- |
| PC2 cannot reach its neighbours | Basics | IP addressing |
| The server is out of reach | Basics | Default gateway |
| Ping goes out, nothing comes back | Intermediate | Static routes |
| Guests have no network | Intermediate | VLANs and trunks |
| OSPF neighbours are missing | Intermediate | OSPF |
| Office PCs get 169.254 addresses | Intermediate | DHCP relay |
| The intranet is blocked | Advanced | Access lists |
| The BGP session stays down | Advanced | BGP |
| The VPN between the sites is down | Advanced | IPsec |

## For teachers (role instructor or admin)

**Writing a scenario.** Build the network with the faults in it as a normal topology. Then
choose **New scenario**: give a title, a briefing (the situation and what must work, not
the fault), a level, hints and the start topology. A copy is taken when you save.

**Goals.** A goal is one of:

| Goal | Passes when |
| --- | --- |
| Ping | a device gets (or does not get) a reply from an address or device |
| TCP connection | a port on a server is open, or is blocked on the way |
| Route present | a device has a route to a network |
| OSPF neighbours | two routers have a full adjacency |
| BGP session | a BGP session to a peer is established |
| IPsec tunnel up | every tunnel of a router is up |
| DHCP lease | a host got an address from DHCP |
| No diagnostic errors | the diagnostics list no errors |

Devices are matched by name. **Test the goals** runs them against any of your topologies:
on the start topology they should fail, on a fixed copy they should pass.

**Publishing and assigning.** A published scenario is visible to every student. An
unpublished one is only visible to the students you assign it to. **Assign** gives a
scenario (built-in or your own) to all students or to some, with an optional due date and
note. Assigned scenarios are listed first for the student.

**Progress.** Lessons & labs → **Progress** shows per student and scenario whether it is
not started, partly done (goals met) or completed, with the number of hints used. Click a
result for details and to copy the student's network into your own topologies.
