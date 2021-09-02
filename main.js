"use strict";
const utils = require('@iobroker/adapter-core');
let net = require('net');
let adapter, query, recnt, haier, in_msg, out_msg, states = {}, old_states = {}, tabu = false, _connect = false;
const polling_time = 2000;
const command = {
    qstn:       [10, 0, 0, 0, 0, 0, 1, 1, 77, 1], // Команда опроса
    poweron:    [10, 0, 0, 0, 0, 0, 1, 1, 77, 2], // Включение кондиционера
    poweroff:   [10, 0, 0, 0, 0, 0, 1, 1, 77, 3], // Выключение кондиционера
    no:         [10, 0, 0, 0, 0, 0, 1, 1, 77, 4], // отображает на дисплее установленную температуру ???
    lockremote: [10, 0, 0, 0, 0, 0, 1, 3, 0, 0],  // Блокировка пульта ???
    healthon:   [10, 0, 0, 0, 0, 0, 1, 1, 77, 9], // Включение режима health (здоровье)
    healthoff:  [10, 0, 0, 0, 0, 0, 1, 1, 77, 8]  // Выключение режима health (здоровье)
};
const byte = {
    temp:       11,
    mode:       21,
    fanspeed:   23,
    swing:      25,
    lockremote: 26,
    fresh:      29,
    settemp:    33,
    power:      27,
    compressor: 27,
    health:     27,
    cmd:        15
};

function startAdapter(options){
    return adapter = utils.adapter(Object.assign({}, options, {
        systemConfig: true,
        name:         'haier',
        ready:        main,
        unload:       (callback) => {
            try {
                adapter.log.debug('cleaned everything up...');
                query && clearInterval(query);
                recnt && clearTimeout(recnt);
                haier && haier.destroy();
                callback();
            } catch (e) {
                callback();
            }
        },
        stateChange:  (id, state) => {
            if (id && state && !state.ack){
                adapter.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
                let ids = id.split(".");
                let val = state.val;
                let cmd = ids[ids.length - 1].toString().toLowerCase();
                adapter.log.debug('cmd ' + cmd);
                sendCmd(cmd, val);
            }
        }
    }));
}

function sendCmd(cmd, val){
    out_msg = in_msg;
    tabu = true;
    switch (cmd) {
        case 'power':
            if (val){
                send(command.poweron);
            } else {
                send(command.poweroff);
            }
            break;
        case 'mode': //4 - DRY, 1 - cool, 2 - heat, 0 - smart, 3 - fan
            if(!states.power && (val !== 'off' || val !== 5)) {
                //send(command.poweron);
                out_msg[byte.power] = 1;
            }
            if (val === 'smart' || val === 'auto' || val === 0){
                val = 0;
            } else if (val === 'cool' || val === 1){
                val = 1;
            } else if (val === 'heat' || val === 2){
                val = 2;
            } else if (val === 'fan' || val === 3){
                val = 3;
            } else if (val === 'dry' || val === 4){
                val = 4;
            } else if (val === 'off' || val === 5){
                send(command.poweroff);
                break;
            }
            out_msg[byte.mode] = val;
            send(out_msg);
            break;
        case 'fanspeed': //Скорость 2 - min, 1 - mid, 0 - max, 3 - auto
            if (val === 'max' || val === 0){
                val = 0;
            } else if (val === 'mid' || val === 1){
                val = 1;
            } else if (val === 'min' || val === 2){
                val = 2;
            } else if (val === 'auto' || val === 3){
                val = 3;
            }
            out_msg[byte.fanspeed] = val;
            send(out_msg);
            break;
        case 'swing': //1 - верхний и нижний предел вкл., 0 - выкл., 2 - левый/правый вкл., 3 - оба вкл
            if (val === false || val === 0 || val === 'off'){
                val = 0;
            } else if (val === 'ud' || val === 1){
                val = 1;
            } else if (val === 'lr' || val === 2){
                val = 2;
            } else if (val === 'both' || val === 3){
                val = 3;
            }
            out_msg[byte.swing] = val;
            send(out_msg);
            break;
        case 'lockremote': //128 блокировка вкл., 0 -  выкл
            if (val === false){
                val = 0;
            } else if (val === true){
                val = 128;
            }
            out_msg[byte.lockremote] = val;
            send(out_msg);
            //send(command.lockremote);
            break;
        case 'fresh': //fresh 0 - off, 1 - on
            if (val === false){
                val = 0;
            } else if (val === true){
                val = 1;
            }
            out_msg[byte.fresh] = val;
            send(out_msg);
            break;
        case 'settemp':
            val = parseInt(val);
            if (val < 16){
                val = 16;
            } else if (val > 30){
                val = 30;
            }
            out_msg[byte.settemp] = val - 16;
            send(out_msg);
            break;
        case 'health':  //on/off 1 - on, 0 - off (16, 17)-Компрессор??? 9 - QUIET (17)
            if (val === true){
                send(command.healthon);
            } else {
                send(command.healthoff);
            }
            break;
        case 'raw':
            send(toArr(val, 2));
            break;
        default:
    }
}

function connect(cb){
    let host = adapter.config.host ? adapter.config.host :'127.0.0.1';
    let port = adapter.config.port ? adapter.config.port :23;
    adapter.log.debug('Haier ' + 'connect to: ' + host + ':' + port);
    haier = net.connect(port, host, function (){
        clearTimeout(recnt);
        adapter.setState('info.connection', true, true);
        adapter.log.info('Haier connected to: ' + host + ':' + port);
        _connect = true;
        clearInterval(query);
        //query = setInterval(function (){
            if (!tabu){
                //send(command.qstn);
                /**
                 byte qstn[13] =  {0xFF, 0xFF, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x4D, 0x01, 0x5A}; // Команда опроса
                 byte qstn1[13] = {0xFF, 0xFF, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x61, 0x00, 0x07, 0x72}; // Команда опроса
                 byte qstn2[11] = {0xFF, 0xFF, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x70, 0x78}; // Команда опроса
                 byte qstn3[11] = {0xFF, 0xFF, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x61, 0x69}; // Команда опроса
                 byte qstn4[11] = {0xFF, 0xFF, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x73, 0x7B}; // Команда опроса
                 //0xFF  0xFF  0x08  0x40  0x00  0x00  0x00  0x00  0x00  0x73  0xBB 0x87 0x01
                 byte on[13] =  {0xFF, 0xFF, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x4D, 0x02, 0x5B}; // Включение кондиционера
                 byte off[13] =  {0xFF, 0xFF, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x4D, 0x03, 0x5C}; // Выключение кондиционера
                 byte lock[13] = {0xFF, 0xFF, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x03, 0x00, 0x00, 0x0E}; // Блокировка пульта
                 byte healthon[13] =  {0xFF, 0xFF, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x4D, 0x09, 0x62};  // Включение режима health (здоровье)
                 byte healthoff[13] = {0xFF, 0xFF, 0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x4D, 0x08, 0x61};  // Выключение режима health (здоровье)
                 
                 byte on2[17] =  {0xFF, 0xFF, 0x0C, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x5D, 0x01, 0x00, 0x01, 0xAC, 0xBD, 0xFB};
                 byte off2[17] = {0xFF, 0xFF, 0x0C, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x5D, 0x01, 0x00, 0x00, 0xAB, 0x7D, 0x3A};
                 byte cmd2[25] = {0xFF, 0xFF, 0x14, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x60, 0x01, 0x09, 0x08, 0x25, 0x00, 0x02, 0x03, 0x00, 0x06, 0x00, 0x0C, 0x03, 0x0B, 0x70};
                 */
                let cmd_test = [0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x4D, 0x01]; // опрос
                  //cmd_test = [0x0C, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x5D, 0x01, 0x00, 0x00, 0xAB, 0x7D, 0x3A];
                    cmd_test = [0x0A, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x61, 0x00, 0x00]; // запрос версии устройства //ffff0a0000000000000300000d
                    cmd_test = [0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x70]; // Запрос идентификационного кода устройства //ffff0a0000000000000300000d
                    cmd_test = [0x0C, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x5D, 0x02, 0x00, 0x01]; // 
                
                
                //send(cmd_test);
                let cmd = Buffer.from(cmd_test);
                let sum = 0;
                for (let key of cmd.keys()) {
                    sum += cmd[key];
                }
                cmd = Buffer.concat([Buffer.from([0xFF, 0xFF]), cmd, Buffer.from([sum])]);
                adapter.log.debug('Send command - ' + cmd.toString("hex").toUpperCase().match(/.{1,2}/g).join(' '));
                haier.write(cmd);
            }
        //}, polling_time);
        cb && cb();
    });
    haier.on('data', function (chunk){
        adapter.log.debug("Haier raw response: {" + chunk.toString('hex').toUpperCase().match(/.{1,2}/g).join('\t') + '} Length packet:[' + chunk.length + ']');
        //ffff22000000000001026d01001a0000007f00000000000100020000000900000000000840
        if (chunk.length === 33 || chunk.length === 34){
            let a;
            chunk[0] = 0;
            if (chunk.length === 34){
                a = Buffer.from([0]);
            } else if (chunk.length === 33){
                a = Buffer.from([0, 0]);
            }
            chunk = Buffer.concat([a, chunk]);
            chunk[0] = 34;
        }
        if (chunk.length === 37){
            in_msg = Buffer.from(chunk);
            in_msg = in_msg.slice(2, 36);
            adapter.log.debug("Haier incomming: " + in_msg.toString('hex'));
            parse(in_msg);
        } else if (chunk.length === 36){
            in_msg = Buffer.from(chunk);
            in_msg = in_msg.slice(1, 35);
            adapter.log.debug("Haier incomming: " + in_msg.toString('hex'));
            parse(in_msg);
        } else if (chunk.length === 35){
            in_msg = Buffer.from(chunk);
            in_msg = in_msg.slice(0, 34);
            adapter.log.debug("Haier incomming: " + in_msg.toString('hex'));
            parse(in_msg);
        } else {
            adapter.log.error("Error length packet. Raw response: {" + chunk.toString('hex') + '} Length packet:[' + chunk.length + ']');
        }
    });
    haier.on('error', function (e){
        err(e);
    });
    haier.on('close', function (e){
        if (_connect){
            err('Haier disconnected');
        }
        reconnect();
    });
}

function send(cmd){
    cmd = Buffer.from(cmd);
    if (cmd !== undefined){
        if (cmd.length > 20 && cmd.length < 35){
            cmd[byte.cmd] = 0; // 00-команда 7F-ответ
            cmd[7] = 1;
            cmd[8] = 77;
            cmd[9] = 95;
        }
        cmd = packet(cmd);
        adapter.log.debug('Send Command: ' + cmd.toString("hex"));
        haier.write(cmd);
        tabu = false;
    }
}

function parse(msg){
    states.temp = msg[byte.temp]; //Текущая температура
    switch (msg[byte.mode]) { //4 - DRY, 1 - cool, 2 - heat, 0 - smart, 3 - вентилятор
        case 0:
            states.mode = 'auto';
            break;
        case 1:
            states.mode = 'cool';
            break;
        case 2:
            states.mode = 'heat';
            break;
        case 3:
            states.mode = 'fan';
            break;
        case 4:
            states.mode = 'dry';
            break;
        default:
    }
    switch (msg[byte.fanspeed]) { //Скорость 2 - min, 1 - mid, 0 - max, 3 - auto
        case 0:
            states.fanspeed = 'max';
            break;
        case 1:
            states.fanspeed = 'mid';
            break;
        case 2:
            states.fanspeed = 'min';
            break;
        case 3:
            states.fanspeed = 'auto';
            break;
        default:
    }
    switch (msg[byte.swing]) { //1 - верхний и нижний предел вкл., 0 - выкл., 2 - левый/правый вкл., 3 - оба вкл
        case 0:
            states.swing = false;
            break;
        case 1:
            states.swing = 'ud';
            break;
        case 2:
            states.swing = 'lr';
            break;
        case 3:
            states.swing = 'both';
            break;
        default:
    }
    states.lockremote = !!msg[byte.lockremote];   //128 блокировка вкл., 0 -  выкл
    states.fresh = !!msg[byte.fresh];             //fresh 0 - off, 1 - on
    states.settemp = msg[byte.settemp] + 16;         //Установленная температура
    if (msg[byte.power] === 1 || msg[byte.power] === 17 || msg[byte.power] === 25 || msg[byte.power] === 9){
        //on/off 1 - on, 0 - off (16, 17)-Компрессор??? 9 - QUIET (17)
        states.power = true;
    } else if (msg[byte.power] === 0 || msg[byte.power] === 16){
        states.power = false;
        states.mode = 'off';
    }
    if (msg[byte.health] === 25 || msg[byte.power] === 9){
        states.health = true; //УФ лампа - режим здоровье
    } else {
        states.health = false;
    }
    if (msg[byte.compressor] === 17){
        states.compressor = true;
    } else if (msg[byte.power] === 16){
        states.compressor = false;
    }
    adapter.log.debug('states ' + JSON.stringify(states));
    Object.keys(states).forEach(function (key){
        if (states[key] !== old_states[key]){
            old_states[key] = states[key];
            adapter.setState(key, {val: states[key], ack: true});
        }
    });
}

function packet(data){
    let chksum = CRC(data);
    return Buffer.concat([Buffer.from([255, 255]), data, Buffer.from([chksum])]);
}

function CRC(d){
    let sum = 0;
    for (let key of d.keys()) {
        sum += d[key];
    }
    return sum;
}

function toArr(text, numb){
    let arr = [], res;
    for (let i = 0; i < text.length / numb; i++) {
        res = parseInt(text.slice(numb * i, numb * i + numb), 16);
        if (!isNaN(res)){
            arr.push(res);
        }
    }
    return arr;
}

function reconnect(){
    adapter.setState('info.connection', false, true);
    query && clearInterval(query);
    recnt && clearTimeout(recnt);
    haier.destroy();
    old_states = {};
    _connect = false;
    adapter.log.info('Reconnect after 60 sec...');
    recnt = setTimeout(() => {
        connect();
    }, 60000);
}

function err(e){
    adapter.log.error("Haier " + e);
    if (e.code === "ENOTFOUND" || e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT"){
        haier.destroy();
    }
}

function main(){
    adapter.subscribeStates('*');
    connect();
}

if (module.parent){
    module.exports = startAdapter;
} else {
    startAdapter();
}