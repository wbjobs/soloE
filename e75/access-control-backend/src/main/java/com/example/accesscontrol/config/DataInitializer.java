package com.example.accesscontrol.config;

import com.example.accesscontrol.model.*;
import com.example.accesscontrol.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.HashSet;
import java.util.Set;

@Slf4j
@Component
@RequiredArgsConstructor
public class DataInitializer implements CommandLineRunner {

    private final PersonRepository personRepository;
    private final TimeSlotPolicyRepository policyRepository;
    private final NfcCardRepository nfcCardRepository;
    private final HolidayRepository holidayRepository;

    @Override
    public void run(String... args) {
        log.info("开始初始化测试数据...");

        if (personRepository.count() == 0) {
            Person zhangsan = new Person(null, "张三", "技术部", "13800138001", "EMP001");
            Person lisi = new Person(null, "李四", "市场部", "13800138002", "EMP002");
            personRepository.save(zhangsan);
            personRepository.save(lisi);
            log.info("创建测试人员: 张三, 李四");
        }

        if (policyRepository.count() == 0) {
            TimeSlotPolicy standardPolicy = new TimeSlotPolicy();
            standardPolicy.setName("标准工作日策略");
            standardPolicy.setDescription("周一至周五 09:00-17:00, 周六 10:00-14:00");
            standardPolicy.setHolidayBlocked(true);

            Set<TimeSlot> slots = new HashSet<>();
            slots.add(new TimeSlot(DayOfWeek.MONDAY, LocalTime.of(9, 0), LocalTime.of(17, 0)));
            slots.add(new TimeSlot(DayOfWeek.TUESDAY, LocalTime.of(9, 0), LocalTime.of(17, 0)));
            slots.add(new TimeSlot(DayOfWeek.WEDNESDAY, LocalTime.of(9, 0), LocalTime.of(17, 0)));
            slots.add(new TimeSlot(DayOfWeek.THURSDAY, LocalTime.of(9, 0), LocalTime.of(17, 0)));
            slots.add(new TimeSlot(DayOfWeek.FRIDAY, LocalTime.of(9, 0), LocalTime.of(17, 0)));
            slots.add(new TimeSlot(DayOfWeek.SATURDAY, LocalTime.of(10, 0), LocalTime.of(14, 0)));
            standardPolicy.setTimeSlots(slots);
            policyRepository.save(standardPolicy);

            TimeSlotPolicy allTimePolicy = new TimeSlotPolicy();
            allTimePolicy.setName("全天通行策略");
            allTimePolicy.setDescription("所有时间段均可通行");
            allTimePolicy.setHolidayBlocked(false);

            Set<TimeSlot> allSlots = new HashSet<>();
            for (DayOfWeek day : DayOfWeek.values()) {
                allSlots.add(new TimeSlot(day, LocalTime.of(0, 0), LocalTime.of(23, 59, 59)));
            }
            allTimePolicy.setTimeSlots(allSlots);
            policyRepository.save(allTimePolicy);

            log.info("创建测试策略: 标准工作日策略, 全天通行策略");
        }

        if (nfcCardRepository.count() == 0) {
            Person zhangsan = personRepository.findByEmployeeId("EMP001").orElseThrow(new java.util.function.Supplier<RuntimeException>() {
                @Override
                public RuntimeException get() {
                    return new RuntimeException("未找到测试人员: EMP001");
                }
            });
            Person lisi = personRepository.findByEmployeeId("EMP002").orElseThrow(new java.util.function.Supplier<RuntimeException>() {
                @Override
                public RuntimeException get() {
                    return new RuntimeException("未找到测试人员: EMP002");
                }
            });
            TimeSlotPolicy standard = policyRepository.findByName("标准工作日策略").orElseThrow(new java.util.function.Supplier<RuntimeException>() {
                @Override
                public RuntimeException get() {
                    return new RuntimeException("未找到测试策略: 标准工作日策略");
                }
            });
            TimeSlotPolicy allTime = policyRepository.findByName("全天通行策略").orElseThrow(new java.util.function.Supplier<RuntimeException>() {
                @Override
                public RuntimeException get() {
                    return new RuntimeException("未找到测试策略: 全天通行策略");
                }
            });

            NfcCard card1 = new NfcCard();
            card1.setUid("NFC001");
            card1.setPerson(zhangsan);
            card1.setPolicy(standard);
            card1.setActive(true);
            nfcCardRepository.save(card1);

            NfcCard card2 = new NfcCard();
            card2.setUid("NFC002");
            card2.setPerson(lisi);
            card2.setPolicy(allTime);
            card2.setActive(true);
            nfcCardRepository.save(card2);

            log.info("创建测试NFC卡: NFC001(张三-标准策略), NFC002(李四-全天策略)");
        }

        if (holidayRepository.count() == 0) {
            Holiday newYear = new Holiday(null, "元旦", LocalDate.of(2026, 1, 1), true, "元旦假期");
            Holiday springFestival = new Holiday(null, "春节", LocalDate.of(2026, 2, 17), true, "春节假期");
            Holiday nationalDay = new Holiday(null, "国庆节", LocalDate.of(2026, 10, 1), true, "国庆假期");
            holidayRepository.save(newYear);
            holidayRepository.save(springFestival);
            holidayRepository.save(nationalDay);
            log.info("创建测试节假日: 元旦, 春节, 国庆节");
        }

        log.info("测试数据初始化完成!");
        log.info("========================================");
        log.info("测试用例:");
        log.info("1. 工作时间通行: --check NFC001 2026-05-18T10:00:00 (周一)");
        log.info("2. 非工作时间拒绝: --check NFC001 2026-05-18T20:00:00 (周一)");
        log.info("3. 周六允许: --check NFC001 2026-05-23T12:00:00 (周六)");
        log.info("4. 节假日禁止: --check NFC001 2026-01-01T10:00:00 (元旦)");
        log.info("5. 李四全天通行: --check NFC002 2026-05-18T23:00:00 (周一深夜)");
        log.info("6. 生成临时访客码: POST /api/tokens {policyId:1,validMinutes:120,visitorName:\"王访客\"}");
        log.info("7. 验证临时访客码: --token <6位码> 2026-05-18T10:00:00");
        log.info("8. 查看访问日志: GET /api/logs");
        log.info("========================================");
    }
}
