#!/bin/sh
set -eu

node_uid=$(id -u node)
node_gid=$(id -g node)
gpu_group_ids=""

for gpu_device in /dev/dri/card* /dev/dri/renderD*; do
  [ -e "${gpu_device}" ] || continue

  gpu_gid=$(stat -c '%g' "${gpu_device}")
  [ "${gpu_gid}" != "0" ] || continue

  case ",${gpu_group_ids}," in
    *,"${gpu_gid}",*) ;;
    *) gpu_group_ids="${gpu_group_ids:+${gpu_group_ids},}${gpu_gid}" ;;
  esac
done

set -- /usr/bin/tini -- "$@"

if [ -n "${gpu_group_ids}" ]; then
  echo "[entrypoint] Granting QVAC access to GPU group IDs: ${gpu_group_ids}"
  exec setpriv \
    --reuid "${node_uid}" \
    --regid "${node_gid}" \
    --groups "${gpu_group_ids}" \
    -- "$@"
fi

exec setpriv \
  --reuid "${node_uid}" \
  --regid "${node_gid}" \
  --clear-groups \
  -- "$@"
