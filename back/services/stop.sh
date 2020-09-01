#!/bin/bash
FILE_PATH=`dirname "$0"`
LOG_PATH=$FILE_PATH/..
timestamp=`date +%Y/%m/%d-%H:%M`
echo "[$timestamp]: [EXPLORER]: stop service..." >> "$LOG_PATH/systemlog"
pkill -f explorer/syncLogistics.js
pkill -f explorer/syncToken.js
pkill -f explorer/server.js