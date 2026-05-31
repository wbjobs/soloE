package com.example.accesscontrol.model;

import javax.persistence.*;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;
import java.util.Set;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "time_slot_policies")
public class TimeSlotPolicy {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    private String description;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "policy_time_slots", joinColumns = @JoinColumn(name = "policy_id"))
    private Set<TimeSlot> timeSlots;

    @Column(nullable = false)
    private boolean holidayBlocked = true;
}
