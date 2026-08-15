#!/bin/sh
IFS= read -r mode < mode
printf '%s\n' "$$" > pid
if [ -n "${AISTAFF_SUPERVISOR_TOKEN+x}" ]; then exit 78; fi
IFS= read -r bootstrap_token || exit 78
if [ "${#bootstrap_token}" -lt 32 ]; then exit 78; fi
first=1
while IFS= read -r line; do
  suffix=${line#*\"request_id\":\"}
  request_id=${suffix%%\"*}
  if [ "$first" = 1 ]; then
    first=0
    printf '{"protocol_version":"aistaff.desktop-supervisor.v1","request_id":"%s","ok":true,"result":{"protocol_version":"aistaff.desktop-supervisor.v1","version":"test","platform":"test","arch":"test","pid":1,"capabilities":["health"],"authentication":"per_launch_token"}}\n' "$request_id"
    continue
  fi
  if [ "$mode" = timeout ]; then continue; fi
  if [ "$mode" = eof ]; then exit 0; fi
  if [ "$mode" = request-id ]; then
    printf '{"protocol_version":"aistaff.desktop-supervisor.v1","request_id":"wrong","ok":true,"result":{"status":"ok","uptime_ms":1}}\n'
    continue
  fi
  printf '{"protocol_version":"aistaff.desktop-supervisor.v1","request_id":"%s","ok":true,"result":{"padding":"%070000d"}}\n' "$request_id" 0
done
