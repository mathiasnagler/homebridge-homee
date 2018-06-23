const attributeTypes = require("../lib/attribute_types");

function HomeeAccessory(name, uuid, profile, node, platform, instance) {
    this.name = name;
    this.uuid = uuid;
    this.platform = platform
    this.log = platform.log;
    this.nodeId = node.id;
    this.profile = profile;
    this.instance = instance || 0;
    this.attributes = node.attributes;
    this.editableAttributes = [];
    this.map = [];
    this.pendingAttributes = {};
}

HomeeAccessory.prototype.setValue = function (value, callback, context, uuid, attributeId) {
    if (context && context == 'ws') {
		callback(null, value);
	    return;
	   }

     let oldValue = this.service.getCharacteristic(this.map[attributeId]).value;
     if (value == oldValue) {
       callback(null, value);
       return
     }

    if (value === true) value = 1;
    if (value === false) value = 0;

    this.pendingAttributes[attributeId] = value
    this.debouncedCommit()
    callback(null, value);
}

HomeeAccessory.prototype.debouncedCommit = debounce(function() {
    var commands = []
    var containsBrightness = false
    for (var attributeId in this.pendingAttributes) {
        var attribute = this.attributes.find(function(attribute) {
            return attribute.id == attributeId
        });

        var HAPType = attributeTypes.getHAPTypeByAttributeType(attribute.type)
        if (HAPType == 'Brightness') {
            containsBrightness = true
            break
        }
    }

    for (var attributeId in this.pendingAttributes) {
        var attribute = this.attributes.find(function(attribute) {
            return attribute.id == attributeId
        });

        var HAPType = attributeTypes.getHAPTypeByAttributeType(attribute.type)
        if (containsBrightness && HAPType == 'On')
            continue

        if (this.pendingAttributes.hasOwnProperty(attributeId))
            commands.push('PUT:/nodes/' + this.nodeId + '/attributes/' + attributeId + '?target_value=' + this.pendingAttributes[attributeId])
    }

    this.pendingAttributes = []

    this.log("Sending command to homee: " + commands.join('/n'))

    commands.forEach(function(command) {
        this.platform.homee.send(command)
    }.bind(this));
}, 200, false)

function debounce(func, wait, immediate) {
    var timeout;
    return function() {
        var context = this, args = arguments;
        var later = function() {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
};

HomeeAccessory.prototype.updateValue = function (attribute) {
    var that = this;

    if (that.service && attribute.id in that.map) {

        let attributeType = attributeTypes.getHAPTypeByAttributeType(attribute.type);
        let newValue = attribute.current_value;
        let oldValue = that.service.getCharacteristic(that.map[attribute.id]).value;
        let targetValue = attribute.target_value;

        if(newValue!==oldValue && newValue===targetValue) {
            that.service.getCharacteristic(that.map[attribute.id])
            .updateValue(newValue, null, 'ws');

            that.log.debug(that.name + ': ' + attributeType + ': ' + newValue);
        }
    }
}

HomeeAccessory.prototype.getServices = function () {
    let informationService = new Service.AccessoryInformation();

    informationService
        .setCharacteristic(Characteristic.Manufacturer, "Homee")
        .setCharacteristic(Characteristic.Model, "")
        .setCharacteristic(Characteristic.SerialNumber, "");

    this.service = new Service[this.profile](this.name);

    // addCharacteristics
    for (let i=0; i<this.attributes.length; i++) {
        let that = this;

        let attributeType = attributeTypes.getHAPTypeByAttributeType(this.attributes[i].type);
        let attributeId = this.attributes[i].id;

        // skip characteristic if instance doesn't match
        if (attributeType === 'On' && this.instance !== 0 && this.attributes[i].instance !== this.instance) continue;

        // ensure that characteristic 'On' is unique --> Fibaro FGS 213
        if (attributeType === 'On' && this.map.indexOf(Characteristic.On) > -1) continue;

        if (attributeType) {
            this.log.debug(attributeType + ': ' + this.attributes[i].current_value);
            this.map[this.attributes[i].id] = Characteristic[attributeType];

            if (!this.service.getCharacteristic(Characteristic[attributeType])) {
                this.service.addCharacteristic(Characteristic[attributeType])
            }

            this.service.getCharacteristic(Characteristic[attributeType])
            .updateValue(this.attributes[i].current_value);

            if (this.attributes[i].editable) {
                this.service.getCharacteristic(Characteristic[attributeType])
                .on('set', function() {
                    var args = Array.prototype.slice.call(arguments);
                    args.push(attributeId);
                    this.setValue.apply(this, args);
                }.bind(this));
            }
        }
    }

    return [informationService, this.service];
};

module.exports = function(oService, oCharacteristic) {
    Service = oService;
    Characteristic = oCharacteristic;

    return HomeeAccessory;
};
