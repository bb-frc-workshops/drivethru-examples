import { Packetizer, ProtocolUtil } from "@bbfrc/drivethru";
import net from "net";
import { Gamepad } from "./gamepad";

// x and y are in range [0, 255], with 127 being neutral
interface IStickAxisData {
    x: number;
    y: number;
}

const protoUtil = new ProtocolUtil();

const socket = new net.Socket();
socket.connect(9001, "localhost", () => {

    const gamepad = new Gamepad("logitech/gamepadf310");
    gamepad.connect();

    gamepad.on("left:move", (data: IStickAxisData) => {
        const val = map(data.y, 0, 255, 0, 180);
        const buf = protoUtil.makeSetServoAngleRequest(0, val);
        const packet = Packetizer.makePacket(buf);
        socket.write(packet);
    });

    gamepad.on("right:move", (data: IStickAxisData) => {
        const val = map(data.y, 0, 255, 0, 180);
        const buf = protoUtil.makeSetServoAngleRequest(1, val);
        const packet = Packetizer.makePacket(buf);
        socket.write(packet);
    });
});

function map(value: number, inLower: number, inUpper: number, outLower: number, outUpper: number): number {
    return (value - inLower) * (outUpper - outLower) / (inUpper - inLower) + outLower;
}
