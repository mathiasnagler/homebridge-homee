'use strict';

let Accessory, Service, Characteristic, UUIDGen;
const Homee = require("./lib/homee");
const nodeTypes = require("./lib/node_types");
let HomeeAccessory, WindowCoveringAccessory, HomeegramAccessory;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;
    Accessory = homebridge.platformAccessory;

    HomeeAccessory = require("./accessories/HomeeAccessory.js")(Service, Characteristic);
    WindowCoveringAccessory = require("./accessories/WindowCoveringAccessory.js")(Service, Characteristic);
    HomeegramAccessory = require("./accessories/HomeegramAccessory.js")(Service, Characteristic);

    homebridge.registerPlatform("homebridge-homee", "homee", HomeePlatform, false);
};

function HomeePlatform(log, config, api) {
    this.log = log;
    this.homee = new Homee(config.host, config.user, config.pass);
    this.debug = config.debug || false;
    this.nodes = [];
    this.homeegrams = [];
    this.foundAccessories = [];
    this.attempts = 0;

    const that = this;

    that.homee
        .connect()
        .then(() => {
            that.log("connected to homee");

            that.homee.send('GET:all');

            that.homee.listen(message => {
                that.handleMessage(message);
            });
        })
        .catch(err => {
            that.log.error(err);
        });

    if (api) {
        this.api = api;
    }
}

HomeePlatform.prototype.accessories = function(callback) {
    let that = this;

    if (that.attempts > 5) {
        that.log.warn("Can't connect to homee!")
        callback([]);
        return;
    }

    that.attempts++;

    if (!that.homee.connected || !that.nodes.length) {
        if (!that.homee.connected) that.log("Not connected to homee. Retrying...");
        setTimeout(() => {
            that.accessories(callback);
        }, 2000);
        return;
    }

    for (let i = 0; i < that.nodes.length; i++) {
        if (that.nodes[i].id < 1) continue;

        let name = decodeURI(that.nodes[i].name);
        let uuid = UUIDGen.generate('homee-' + that.nodes[i].id);
        let newAccessory;
        let nodeType = nodeTypes.getAccessoryTypeByNodeProfile(that.nodes[i].profile);

        if (nodeType === 'WindowCovering') {
            that.log.debug(name + ': ' + nodeType);
            newAccessory = new WindowCoveringAccessory(name, uuid, nodeType, that.nodes[i], that);
        } else if (nodeType === 'DoubleSwitch') {
            that.log.debug(name + ': ' + nodeType);
            that.foundAccessories.push(new HomeeAccessory(name + '-1', uuid, 'Switch', that.nodes[i], that, 1))
            let uuid2 = UUIDGen.generate('homee-' + that.nodes[i].id + '2');
            newAccessory = new HomeeAccessory(name + '-2', uuid2, 'Switch', that.nodes[i], that, 2);
        } else if (nodeType) {
            that.log.debug(name + ': ' + nodeType);
            newAccessory = new HomeeAccessory(name, uuid, nodeType, that.nodes[i], that);
        } else {
            that.log.debug(name + ': unknown Accessory Type');
        }

        if (newAccessory) {
            that.foundAccessories.push(newAccessory);
        }
    }

    for (let i = 0; i < that.homeegrams.length; i++) {
        let name = decodeURI(that.homeegrams[i].name);
        let uuid = UUIDGen.generate('homee-hg-' + that.homeegrams[i].id);
        let newAccessory = '';

        that.log.debug(name + ': Homeegram');
        newAccessory = new HomeegramAccessory(name, uuid, that.homeegrams[i], that);
        that.foundAccessories.push(newAccessory);
    }

    callback(that.foundAccessories);
};

/**
 * filter nodes if group 'homebridge' exists
 * @param  Object all   groups, relationships, nodes, homeegrams
 * @return Array   filtered or all nodes and homeegrams
 */
HomeePlatform.prototype.filterDevices = function (all) {
    let groupId;
    let nodeIds = [];
    let homeegramIds = [];
    let filtered = {nodes: [], homeegrams: []};

    for (let group of all.groups) {
        if (group.name.match(/^homebridge$/i)) {
            groupId = group.id;
        }
    }

    if(!groupId) return [all.nodes, all.homeegrams];

    for (let relationship of all.relationships) {
        if (relationship.group_id === groupId) {
            nodeIds.push(relationship.node_id);
            homeegramIds.push(relationship.homeegram_id);
        }
    }

    for (let node of all.nodes) {
        if (nodeIds.indexOf(node.id) !== -1) {
            filtered.nodes.push(node);
        }
    }

    for (let homeegram of all.homeegrams) {
        if (homeegramIds.indexOf(homeegram.id) !== -1) {
            filtered.homeegrams.push(homeegram);
        }
    }

    return [filtered.nodes, filtered.homeegrams];
}

/**
 * handle incoming messages
 * @param  Object  message  incoming homee message
 */
HomeePlatform.prototype.handleMessage = function (message) {
    var that = this;

    if (message.all && !that.foundAccessories.length) {
        [that.nodes, that.homeegrams] = that.filterDevices(message.all);
    } else if (message.attribute || message.node) {
        let attributes = message.node ? message.node.attributes : [message.attribute];

        attributes.forEach((attribute) => {
            for (let i=0; i<that.foundAccessories.length; i++) {
                const accessory = that.foundAccessories[i];
                if (accessory.nodeId === attribute.node_id) {
                    accessory.updateValue(attribute);
                }
            }
        })
    }
}
